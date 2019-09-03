'use strict';

import debug from 'debug';
import {
    InputSubscriptionModel, MainInstance,
    Subscription, SubscriptionProtocol
} from 'enqueuer';
import { HttpContainerPool } from 'enqueuer/js/pools/http-container-pool';
import { ProtocolDocumentation } from 'enqueuer/js/protocols/protocol-documentation';
import * as express from 'express-serve-static-core';
import * as _ from 'lodash';
import * as xml2js from 'xml2js';
import { BindConfig } from './bind-config';

interface Message {
    body: any;
    headers: any;
}

export class HttpBindSubscription extends Subscription {
    private static serviceHandlers: any = {};

    private readonly proxy: boolean;
    private redirect: Message;
    private responseToClientHandler?: any;
    private secureServer: boolean;
    private httpServer: express.Router;
    private bind: Array<BindConfig>;
    private debugger = debug('Enqueuer:Plugin:HttpBind:Subscription');

    constructor(subscription: InputSubscriptionModel) {
        super(subscription);
        this.debugger(`Creating new SOAP subscription <<%s>>. Configuration: %J`, this.name, _.omit(subscription, 'parent'));
        this.bind = _.castArray(this.bind || []);
        this.type = this.type.toLowerCase();
        this.secureServer = this.isSecureServer();
        this.proxy = this.isProxyServer();
    }

    public async subscribe(): Promise<void> {
        try {
            this.httpServer = await HttpContainerPool.getApp(this.port, this.secureServer, this.credentials);
            this.createServiceHandler();
        } catch (error) {
            const message = `Error in ${this.type} subscription: ${error}`;
            throw new Error(message);
        }
    }

    public unsubscribe(): Promise<void> {
        return HttpContainerPool.releaseApp(this.port);
    }

    public async receiveMessage(): Promise<any> {
        if (this.proxy) {
            return this.proxyServerMessageReceiving();
        } else {
            return this.realServerMessageReceiving();
        }
    }

    public async sendResponse(): Promise<void> {
        this.debugger(`%s sending response: %J`, this.name, this.response);
        try {
            Object.keys(this.response.headers || {}).forEach(key => {
                this.responseToClientHandler.header(key, this.response.headers[key]);
            });
            const body = typeof this.response.payload === 'number' ? '' + this.response.payload : this.response.payload;
            this.responseToClientHandler.status(this.response.status).send(body);
            this.debugger(`%s ${this.type} response sent`, this.name);
        } catch (err) {
            throw new Error(`${this.type} [${this.name}] - Error sending response: ${err}`);
        }
    }

    private async realServerMessageReceiving(): Promise<void> {
        return new Promise((resolve) => {
            this.debugger(`%s: HTTP server listenning for requests on port: %d`, this.name, this.port);
            const realServerFunction = async (request: any, responseHandler: any, next: any) => {
                this.debugger(`%s got hit URL: %o`, this.name, request.url);
                this.debugger(`%s got hit with headers: %o`, this.name, request.headers);
                this.debugger(`%s got hit with body: %o`, this.name, request.rawBody);
                request.body = request.rawBody;
                if (this.responseToClientHandler) {
                    next();
                }
                this.responseToClientHandler = responseHandler;
                const serviceCalled = await this.callSoapService(request);
                if (serviceCalled) {
                    return resolve();
                }
                next();
            };
            this.httpServer.post(this.path, realServerFunction);
        });
    }

    private createServiceHandler() {
        this.debugger('%s. Creating service handler.', this.name);
        const serviceHandler = _.set(HttpBindSubscription.serviceHandlers, `${this.name}`,
            (body: any, headers: any) => {
                const message = this.createMessageReceivedStructure(body, headers);
                this.debugger('Service %s Called with message: %o.', this.name, message);
                if (this.proxy) {
                    this.redirect = message;
                    this.executeHookEvent('onOriginalMessageReceived', this.redirect);
                    return this.callThroughProxy(this.redirect);
                } else {
                    this.executeHookEvent('onMessageReceived', message);
                    return message;
                }
            });
        this.debugger('%s. Service Handler created: %o.', this.name, serviceHandler);

        return serviceHandler;
    }

    private async callSoapService(request: express.Request) {
        const payload = await this.parseBody(request.body);

        if (this.shouldCallService(request.headers, payload)) {
            const service = this.getServiceHandler();
            service(payload, request.headers);
            return true;
        }
        this.debugger(`%s: Ignoring request`, this.name);
        return false;
    }

    private async parseXMLBody(body: string) {
        return new Promise<any>((resolve, reject) => {
            const parser = new xml2js.Parser({
                explicitArray: false,
                tagNameProcessors: [
                    xml2js.processors.stripPrefix
                ]
            });
            parser.parseString(body,
                (error: any, payload: any) => {
                    if (error) {
                        return reject(error);
                    }
                    return resolve(payload);
                });
        });
    }

    private async parseBody(body: string) {
        if (this.bodyType && this.bodyType.toUpperCase() === 'XML') {
            return this.parseXMLBody(body);
        }
        return JSON.parse(body);
    }

    private shouldCallService(headers: any, payload: any) {
        this.debugger(`verifying service payload: %J`, payload);
        return _.every(this.bind, (predicate) => this.checkPredicate(headers, payload, predicate));
    }

    private checkPredicate(headers: any, payload: any, predicate: BindConfig) {
        this.debugger(`verifying predicate: %J`, predicate);
        let propertyValue: string = _.get(predicate, 'request.body');
        let target: any = payload;
        if (!propertyValue) {
            propertyValue = _.get(predicate, 'request.header');
            target = headers;
        }
        if (!propertyValue) {
            return false;
        }
        const value = _.get(target, propertyValue);
        this.debugger(`[%s] Checking predicate. Expected: %s. Found: %s`, this.name, predicate.value, value);
        return predicate.value === value;
    }

    private getServiceHandler() {
        return _.get(HttpBindSubscription.serviceHandlers, `${this.name}`, null);
    }

    private async callThroughProxy(message: Message) {
        try {
            this.response = await this.redirectCall(message);
            this.debugger(`%s. ${this.type}:${this.port} got redirection response: %J`, this.name, this.response);
            this.executeHookEvent('onMessageReceived', this.response);
            // mesageReceived(this.response);
        } catch (err) {
            this.debugger(`%s. ${this.type}:${this.port} got error response: %J`, this.name, err);
            // errorReceived(err);
        }
    }

    private createMessageReceivedStructure(args: any, headers: any): Message {
        return {
            body: _.cloneDeep(args),
            headers: _.cloneDeep(headers || {})
        };
    }

    private async redirectCall(message: Message): Promise<any> {
        // const config: InputPublisherModel = {
        //     headers: message.headers,
        //     ignoreHooks: true,
        //     name: this.name,
        //     options: {
        //         path: this.path
        //     },
        //     payload: message.body,
        //     soap: _.cloneDeep(this.soap),
        //     timeout: this.timeout,
        //     type: this.type
        // };

        // const soapPublisher = new SoapPublisher(config);
        // this.debugger(`%s. Redirecting call from localhost:${this.port}(${this.path}) to ${this.path}`, this.name);
        // return await soapPublisher.publish();
    }

    private isSecureServer(): boolean {
        return (this.credentials ? true : false);
    }

    private isProxyServer(): boolean {
        if (this.type) {
            return this.type.indexOf('proxy') !== -1;
        }
        throw new Error(`Http server type is not known: ${this.type}`);
    }
}

export function entryPoint(mainInstance: MainInstance): void {
    const httpBindSubscriptionDoc: ProtocolDocumentation = require('./http-bind-subscription-doc.json');
    const httpBindProtocol = new SubscriptionProtocol('http-bind',
        (subscriptionModel: InputSubscriptionModel) => new HttpBindSubscription(subscriptionModel), httpBindSubscriptionDoc)
        .addAlternativeName('http-bind-proxy', 'http-bind-server')
        .setLibrary('http-bind');
    mainInstance.protocolManager.addProtocol(httpBindProtocol);
}