module.exports = {
  build: {
    "index.html": "index.html",
    "app.js": [
      "javascripts/app.js"
    ],
    "app.css": [
      "stylesheets/app.css"
    ],
    "images/": "images/"
  },
  rpc: {
    host: "localhost",
    port: 8545,
    gas: 10485760
  },
  networks: {
    "parity": {
      network_id: 8995,
      host: "13.93.51.19",
      port: 8540
    },
    "development": {
      network_id: 1,
      host: "127.0.0.1",
      port: 8545,
      gas: 10485760
    },
    "do":{
      network_id: 1900,
      host: "95.85.29.240",
      port: 8000
    }
  }
};