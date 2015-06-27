[![NPM info](https://nodei.co/npm/oniyi-cache.png?downloads=true)](https://nodei.co/npm/oniyi-cache.png?downloads=true)

[![dependencies](https://david-dm.org/benkroeger/oniyi-cache.png)](https://david-dm.org/benkroeger/oniyi-cache.png)

> RFC2616 compliant http cache implementation


## Install

```sh
$ npm install --save oniyi-cache
```


## Usage

```js
var oniyiCache = require('oniyi-cache');

oniyiCache({
	storePrivate: false,
	storeNoStore: false,
	ignoreNoLastMod: false,
	requestValidators: [],
	responseValidators: [],
	hostConfig: {
		'www.npmjs.org': {
			storePrivate: true,
			storeNoStore: true
		}	
	}
});

```

## Methods

### hash(requestObject)
creates a hash string from the provided request object

### addHostConfigs(config)

### setHostConfigs(config)

### updateHostConfigs(config)

### clearHostConfigs(config)

### getEvaluator(hostname, config)

## Kudos

The basic concept here has been borrowed from Chris Corbyn's node-http-cache.

## Changelog
0.0.5 --> added "authorization" to the exclusion list of headers for calculating the request hash

## License

MIT © [Benjamin Kroeger]()


[npm-image]: https://badge.fury.io/js/oniyi-cache.svg
[npm-url]: https://npmjs.org/package/oniyi-cache
