# DelegatedStaking
Delegated staking logic imbedded in stubs representing information available on chain.

## Install
Requires Node v18

`$ npm install`

## Run tests
You need an account with a few AE. You may provide a node URL, if none is provided it will be ran on mainnet.
The SDK expects the private key in the new `sk_` format, which you can convert your private key into, [here](https://docs.aeternity.com/aepp-sdk-js/develop/examples/browser/tools/)
Provide it to the test without the `sk_`prefix. E.g. if your privatekey is `sk_1dqTNf8DHcbqLwWo9a8QYqcuQFkapFWfFudxc87at2aFAE43kb` you would run:
`$ FUND_SOURCE_ACC_KEY='1dqTNf8DHcbqLwWo9a8QYqcuQFkapFWfFudxc87at2aFAE43kb' npm run test`

alternatively, create a `.env` file and put your env vars there there:

```
NODE_URL='https://mainnet.aeternity.io'
FUND_SOURCE_ACC_KEY='1dqTNf8DHcbqLwWo9a8QYqcuQFkapFWfFudxc87at2aFAE43kb'
```

then just run `$ npm run test` and everything will be read from there.

