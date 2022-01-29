var Web3 = require('web3');
var provider = 'https://mainnet.infura.io/v3/d2c350e755e742cda3a9a8d7084a8f01';
var web3Provider = new Web3.providers.HttpProvider(provider);
var web3 = new Web3(web3Provider);
web3.eth.getBlockNumber().then((result) => {
  console.log("Latest Ethereum Block is ",result);
});