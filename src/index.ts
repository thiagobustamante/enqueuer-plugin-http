'use strict';

import debug from 'debug';
import { MainInstance } from 'enqueuer';
import * as subscription from './http-bind-subscription';


debug.formatters.J = (v) => {
    return JSON.stringify(v, null, 2);
};

const tracer = debug('Enqueuer:Plugin:HttpBind');
export function entryPoint(mainInstance: MainInstance): void {
    tracer('Loading Enqueuer HttpBind plugin');
    subscription.entryPoint(mainInstance);
    tracer('Enqueuer HttpBind plugin loaded');
}