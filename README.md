# Enqueuer SOAP plugin 

## Install

```sh
npm i enqueuer-plugin-soap
```

# Usage Example

```yaml
subscriptions:
  - name: Soap Server
    type: soap
    port: 9876
    path: /server
    soap:
      wsdl: './examples/wsdl/MyService.wsdl'
      service: MySoapService
      port: MyServicePortType
      operation: MyServiceRQ
    response: 
      applicationResults:
        success: 
          type: Application
publishers:
  - name: Publisher Example
    type: soap
    payload:
      MyServiceRQ:
        attributes:
        Type: MyType
    headers: 
      myheader: Test Header
    soap:
      wsdl: './examples/wsdl/MyService.wsdl'
      service: MySoapService
      port: MyServicePortType
      operation: MyServiceRQ
    options:
      endpoint: 'http://localhost:9876/server'
```

## Proxy Example

The following example shows one publisher, hiting an proxy subscritpion that points to other mocked subcsription:

```yaml
subscriptions:
  - name: Soap Server
    type: soap
    port: 8765
    path: /server
    soap:
      wsdl: './examples/wsdl/MyService.wsdl'
      service: MySoapService
      port: MyServicePortType
      operation: MyServiceRQ
    response: 
      applicationResults:
        success: 
          type: Application
    onMessageReceived:
      assertions:
        - expect: body.MyServiceRQ.attributes.Type
          toBeEqualTo: `MyType`
        - expect: headers.myheader
          toBeEqualTo: `Test Header`
        - expect: headers.newHeader
          toBeEqualTo: `New Header`
  - name: Soap Proxy
    type: soap-proxy
    port: 9876
    path: /server
    soap:
      wsdl: './examples/wsdl/MyService.wsdl'
      service: MySoapService
      port: MyServicePortType
      operation: MyServiceRQ
    endpoint: 'http://localhost:8765/server'
    onOriginalMessageReceived:
      script: this.redirect.headers.newHeader = 'New Header';
      assertions:
        - expect: body.body.MyServiceRQ.attributes.Type
          toBeEqualTo: `MyType`
        - expect: headers['myheader']
          toBeEqualTo: `Test Header`
    onMessageReceived:
      assertions:
        - expect: body.applicationResults.success.type
          toBeEqualTo: `Application`
publishers:
  - name: Publisher Example
    type: soap
    payload:
      MyServiceRQ:
        attributes:
        Type: MyType
    headers: 
      myheader: Test Header
    soap:
      wsdl: './examples/wsdl/MyService.wsdl'
      service: MySoapService
      port: MyServicePortType
      operation: MyServiceRQ
    options:
      endpoint: 'http://localhost:9876/server'
      preserveWhitespace: true
```