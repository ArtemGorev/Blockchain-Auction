var Web3 = require("web3");
var SolidityEvent = require("web3/lib/web3/event.js");

(function() {
  // Planned for future features, logging, etc.
  function Provider(provider) {
    this.provider = provider;
  }

  Provider.prototype.send = function() {
    this.provider.send.apply(this.provider, arguments);
  };

  Provider.prototype.sendAsync = function() {
    this.provider.sendAsync.apply(this.provider, arguments);
  };

  var BigNumber = (new Web3()).toBigNumber(0).constructor;

  var Utils = {
    is_object: function(val) {
      return typeof val == "object" && !Array.isArray(val);
    },
    is_big_number: function(val) {
      if (typeof val != "object") return false;

      // Instanceof won't work because we have multiple versions of Web3.
      try {
        new BigNumber(val);
        return true;
      } catch (e) {
        return false;
      }
    },
    merge: function() {
      var merged = {};
      var args = Array.prototype.slice.call(arguments);

      for (var i = 0; i < args.length; i++) {
        var object = args[i];
        var keys = Object.keys(object);
        for (var j = 0; j < keys.length; j++) {
          var key = keys[j];
          var value = object[key];
          merged[key] = value;
        }
      }

      return merged;
    },
    promisifyFunction: function(fn, C) {
      var self = this;
      return function() {
        var instance = this;

        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {
          var callback = function(error, result) {
            if (error != null) {
              reject(error);
            } else {
              accept(result);
            }
          };
          args.push(tx_params, callback);
          fn.apply(instance.contract, args);
        });
      };
    },
    synchronizeFunction: function(fn, instance, C) {
      var self = this;
      return function() {
        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {

          var decodeLogs = function(logs) {
            return logs.map(function(log) {
              var logABI = C.events[log.topics[0]];

              if (logABI == null) {
                return null;
              }

              var decoder = new SolidityEvent(null, logABI, instance.address);
              return decoder.decode(log);
            }).filter(function(log) {
              return log != null;
            });
          };

          var callback = function(error, tx) {
            if (error != null) {
              reject(error);
              return;
            }

            var timeout = C.synchronization_timeout || 240000;
            var start = new Date().getTime();

            var make_attempt = function() {
              C.web3.eth.getTransactionReceipt(tx, function(err, receipt) {
                if (err) return reject(err);

                if (receipt != null) {
                  // If they've opted into next gen, return more information.
                  if (C.next_gen == true) {
                    return accept({
                      tx: tx,
                      receipt: receipt,
                      logs: decodeLogs(receipt.logs)
                    });
                  } else {
                    return accept(tx);
                  }
                }

                if (timeout > 0 && new Date().getTime() - start > timeout) {
                  return reject(new Error("Transaction " + tx + " wasn't processed in " + (timeout / 1000) + " seconds!"));
                }

                setTimeout(make_attempt, 1000);
              });
            };

            make_attempt();
          };

          args.push(tx_params, callback);
          fn.apply(self, args);
        });
      };
    }
  };

  function instantiate(instance, contract) {
    instance.contract = contract;
    var constructor = instance.constructor;

    // Provision our functions.
    for (var i = 0; i < instance.abi.length; i++) {
      var item = instance.abi[i];
      if (item.type == "function") {
        if (item.constant == true) {
          instance[item.name] = Utils.promisifyFunction(contract[item.name], constructor);
        } else {
          instance[item.name] = Utils.synchronizeFunction(contract[item.name], instance, constructor);
        }

        instance[item.name].call = Utils.promisifyFunction(contract[item.name].call, constructor);
        instance[item.name].sendTransaction = Utils.promisifyFunction(contract[item.name].sendTransaction, constructor);
        instance[item.name].request = contract[item.name].request;
        instance[item.name].estimateGas = Utils.promisifyFunction(contract[item.name].estimateGas, constructor);
      }

      if (item.type == "event") {
        instance[item.name] = contract[item.name];
      }
    }

    instance.allEvents = contract.allEvents;
    instance.address = contract.address;
    instance.transactionHash = contract.transactionHash;
  };

  // Use inheritance to create a clone of this contract,
  // and copy over contract's static functions.
  function mutate(fn) {
    var temp = function Clone() { return fn.apply(this, arguments); };

    Object.keys(fn).forEach(function(key) {
      temp[key] = fn[key];
    });

    temp.prototype = Object.create(fn.prototype);
    bootstrap(temp);
    return temp;
  };

  function bootstrap(fn) {
    fn.web3 = new Web3();
    fn.class_defaults  = fn.prototype.defaults || {};

    // Set the network iniitally to make default data available and re-use code.
    // Then remove the saved network id so the network will be auto-detected on first use.
    fn.setNetwork("default");
    fn.network_id = null;
    return fn;
  };

  // Accepts a contract object created with web3.eth.contract.
  // Optionally, if called without `new`, accepts a network_id and will
  // create a new version of the contract abstraction with that network_id set.
  function Contract() {
    if (this instanceof Contract) {
      instantiate(this, arguments[0]);
    } else {
      var C = mutate(Contract);
      var network_id = arguments.length > 0 ? arguments[0] : "default";
      C.setNetwork(network_id);
      return C;
    }
  };

  Contract.currentProvider = null;

  Contract.setProvider = function(provider) {
    var wrapped = new Provider(provider);
    this.web3.setProvider(wrapped);
    this.currentProvider = provider;
  };

  Contract.new = function() {
    if (this.currentProvider == null) {
      throw new Error("contract error: Please call setProvider() first before calling new().");
    }

    var args = Array.prototype.slice.call(arguments);

    if (!this.unlinked_binary) {
      throw new Error("contract error: contract binary not set. Can't deploy new instance.");
    }

    var regex = /__[^_]+_+/g;
    var unlinked_libraries = this.binary.match(regex);

    if (unlinked_libraries != null) {
      unlinked_libraries = unlinked_libraries.map(function(name) {
        // Remove underscores
        return name.replace(/_/g, "");
      }).sort().filter(function(name, index, arr) {
        // Remove duplicates
        if (index + 1 >= arr.length) {
          return true;
        }

        return name != arr[index + 1];
      }).join(", ");

      throw new Error("contract contains unresolved libraries. You must deploy and link the following libraries before you can deploy a new version of contract: " + unlinked_libraries);
    }

    var self = this;

    return new Promise(function(accept, reject) {
      var contract_class = self.web3.eth.contract(self.abi);
      var tx_params = {};
      var last_arg = args[args.length - 1];

      // It's only tx_params if it's an object and not a BigNumber.
      if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
        tx_params = args.pop();
      }

      tx_params = Utils.merge(self.class_defaults, tx_params);

      if (tx_params.data == null) {
        tx_params.data = self.binary;
      }

      // web3 0.9.0 and above calls new twice this callback twice.
      // Why, I have no idea...
      var intermediary = function(err, web3_instance) {
        if (err != null) {
          reject(err);
          return;
        }

        if (err == null && web3_instance != null && web3_instance.address != null) {
          accept(new self(web3_instance));
        }
      };

      args.push(tx_params, intermediary);
      contract_class.new.apply(contract_class, args);
    });
  };

  Contract.at = function(address) {
    if (address == null || typeof address != "string" || address.length != 42) {
      throw new Error("Invalid address passed to contract.at(): " + address);
    }

    var contract_class = this.web3.eth.contract(this.abi);
    var contract = contract_class.at(address);

    return new this(contract);
  };

  Contract.deployed = function() {
    if (!this.address) {
      throw new Error("Cannot find deployed address: contract not deployed or address not set.");
    }

    return this.at(this.address);
  };

  Contract.defaults = function(class_defaults) {
    if (this.class_defaults == null) {
      this.class_defaults = {};
    }

    if (class_defaults == null) {
      class_defaults = {};
    }

    var self = this;
    Object.keys(class_defaults).forEach(function(key) {
      var value = class_defaults[key];
      self.class_defaults[key] = value;
    });

    return this.class_defaults;
  };

  Contract.extend = function() {
    var args = Array.prototype.slice.call(arguments);

    for (var i = 0; i < arguments.length; i++) {
      var object = arguments[i];
      var keys = Object.keys(object);
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        var value = object[key];
        this.prototype[key] = value;
      }
    }
  };

  Contract.all_networks = {
  "123123": {
    "abi": [
      {
        "constant": false,
        "inputs": [
          {
            "name": "title",
            "type": "string"
          },
          {
            "name": "photo",
            "type": "string"
          },
          {
            "name": "startPrice",
            "type": "uint256"
          },
          {
            "name": "step",
            "type": "uint256"
          },
          {
            "name": "duration",
            "type": "uint256"
          },
          {
            "name": "description",
            "type": "string"
          }
        ],
        "name": "addLot",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "_lotIndex",
            "type": "uint256"
          },
          {
            "name": "_betIndex",
            "type": "uint256"
          }
        ],
        "name": "getBet",
        "outputs": [
          {
            "name": "",
            "type": "string"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "kill",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "_index",
            "type": "uint256"
          }
        ],
        "name": "getTraderLot",
        "outputs": [
          {
            "name": "",
            "type": "string"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getTraderLotsAmount",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "x",
            "type": "address"
          }
        ],
        "name": "addressToString",
        "outputs": [
          {
            "name": "",
            "type": "string"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "b",
            "type": "bytes1"
          }
        ],
        "name": "char",
        "outputs": [
          {
            "name": "c",
            "type": "bytes1"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "_index",
            "type": "uint256"
          }
        ],
        "name": "getLastBet",
        "outputs": [
          {
            "name": "",
            "type": "string"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_index",
            "type": "uint256"
          }
        ],
        "name": "postBet",
        "outputs": [],
        "payable": true,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "v",
            "type": "uint256"
          }
        ],
        "name": "uintToBytes32",
        "outputs": [
          {
            "name": "ret",
            "type": "bytes32"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getAmountOfLots",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "x",
            "type": "bytes32"
          }
        ],
        "name": "bytes32ToString",
        "outputs": [
          {
            "name": "",
            "type": "string"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "_index",
            "type": "uint256"
          }
        ],
        "name": "getLot",
        "outputs": [
          {
            "name": "",
            "type": "string"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "input",
            "type": "uint256"
          }
        ],
        "name": "uintToString",
        "outputs": [
          {
            "name": "",
            "type": "string"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_index",
            "type": "uint256"
          }
        ],
        "name": "confirmDelivery",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "inputs": [],
        "type": "constructor"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "log",
            "type": "string"
          }
        ],
        "name": "log",
        "type": "event"
      }
    ],
    "unlinked_binary": "0x6060604052600080546c0100000000000000000000000033810204600160a060020a0319909116179055611a28806100376000396000f3606060405236156100b95760e060020a60003504631d7c4f8681146100be5780632301b83d146101cc57806341c0e1b5146102225780634debd9911461024f57806357dc50c6146103405780635e57966d146103a057806369f9ad2f146103b05780636f6d69d01461040857806380897d3b14610418578063886d3db91461048a5780638a58a1581461049a5780639201de55146104b5578063ab995d121461057a578063e93956791461062d578063fd84cb971461063d575b610002565b34610002576106e76004808035906020019082018035906020019191908080601f01602080910402602001604051908101604052809392919081815260200183838082843750506040805160208835808b0135601f81018390048302840183019094528383529799986044989297509190910194509092508291508401838280828437505060408051602060a435808b0135601f8101839004830284018301909452838352979998359860643598608435985090965060c49550919350602491909101919081908401838280828437509496505050505050506001805480820180835582818380158290116108d0576008028160080283600052602060002091820191016108d091906109a9565b34610002576106e9600435602435604080516020818101835260008083528581526002909152918220805491929184908110156100025790600052602060002090600302016000509050610c4661075784610442565b34610002576106e760005433600160a060020a0390811691161415610e0957600054600160a060020a0316ff5b34610002576106e960043560408051602081810183526000808352835180830185528181528451808401865282815285518085018752838152865180860188528481528751808701895285815288518088018a5286815289519788019099528587529697949687968796905b6001548910156100b95733600160a060020a031660016000508a815481101561000257906000526020600020906008020160005054600160a060020a03161415610e0b578b8a1415610e0b57600180548a908110156100025790600052602060002090600802016000508054909850610e1c90610e7f90600160a060020a0316610786565b34610002576104a3600080805b6001548110156110c85733600160a060020a0316600160005082815481101561000257906000526020600020906008020160005054600160a060020a03161415610398576001909101905b60010161034d565b34610002576106e9600435610786565b34610002576108366004355b60007f0a00000000000000000000000000000000000000000000000000000000000000600160f860020a03198316101561113f578160f860020a900460300160f860020a029050611153565b34610002576106e960043561085a565b6106e760043560006000600060006000600060006000600080516020611a08833981519152611190345b6040805160208101909152600081526116466104c1835b60008115156113db57507f30000000000000000000000000000000000000000000000000000000000000005b611153565b34610002576104a3600435610459565b34610002576001545b60408051918252519081900360200190f35b34610002576106e96004355b60408051602081810183526000808352835180830185528181528451808401865282815294519394909391928392839291908059106104fd5750595b908082528060200260200182016040528015610514575b50945060009350600092505b6020831015611401576008830260020a87029150600160f860020a031982161561056f57818585815181101561000257906020010190600160f860020a031916908160001a9053506001909301925b600190920191610520565b346100025760408051602080820183526000808352835180830185528181528451808401865282815285518085018752838152865180860188528481528751808701895285815288518088018a5286815289518089018b528781528a51808a018c528881528b51808b018d528981528c519a8b01909c52888a52600180546106e99d6004359d9c909290918e908110156100025790600052602060002090600802016000509a5061148a610e7f8e610442565b34610002576106e9600435610442565b34610002576106e760043560006000600060006000856001600050805490501080156106695750600086105b1561164d57604080516020808252602a908201527f286c6f74732e6c656e677468203c205f696e646578202626205f696e64657820818301527f3c2030292066616c73650000000000000000000000000000000000000000000060608201529051600080516020611a088339815191529181900360800190a16108c8565b005b60405180806020018281038252838181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f1680156107495780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b604080518082019091526001815260f860020a603b0260208201528354610c7f90610db890600160a060020a03165b60206040519081016040528060008152602001506020604051908101604052806000815260200150600060006000600060286040518059106107c55750595b9080825280602002602001820160405280156107dc575b509450600093505b60148410156110ce578360130360080260020a87600160a060020a03168115610002570460f860020a9081029350601081850460ff81168290048302945082850490910290030290506110dc826103bc565b60408051600160f860020a03199092168252519081900360200190f35b91506116228d5b6040805160208181018352600080835284815260029091529182208054919290919080808315156111585760018054889081101561000257600091825260209091206003600890920201908101546004820154919450600a8104910101915061118982610442565b50505050505b505050505050565b50505060009283526020808420604080516101008082018352338083528286018f9052928201899052606082018c9052608082018b90524260a083015260c082018a905260e082018d905260089096029092018054600160a060020a0319166c01000000000000000000000000928302929092049190911781558b5160018083018054818a529886902096989497939690956002928616159094026000190190941604601f90810183900484019391928e0190839010610ace57805160ff19168380011785555b50610afe929150610a7a565b50506008015b80821115610a8e578054600160a060020a031916815560018082018054600080835592600260001991831615610100029190910190911604601f819010610a6057505b5060028201600050805460018160011615610100020316600290046000825580601f10610a9257505b506000600383018190556004830181905560058301819055600683018190556007830180549181559060026101006001831615026000190190911604601f819010610ab057506109a3565b601f0160209004906000526020600020908101906109ec91905b80821115610a8e5760008155600101610a7a565b5090565b601f016020900490600052602060002090810190610a159190610a7a565b601f0160209004906000526020600020908101906109a39190610a7a565b82800160010185558215610997579182015b82811115610997578251826000505591602001919060010190610ae0565b50506040820151816002016000509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10610b5d57805160ff19168380011785555b50610b8d929150610a7a565b82800160010185558215610b51579182015b82811115610b51578251826000505591602001919060010190610b6f565b5050606082015160038201556080820151600482015560a0820151600582015560c0820151600682015560e0820151805160078301805460008281526020908190209294601f6002610100600186161502600019019094169390930483018290048401949392910190839010610c1657805160ff19168380011785555b506108c2929150610a7a565b82800160010185558215610c0a579182015b82811115610c0a578251826000505591602001919060010190610c28565b949350505050565b820191906000526020600020905b815481529060010190602001808311610c5c57829003601f168201915b50505050505b6040805160208181018352600080835283518083018552818152845192830190945281529091610c4691869186918691905b60408051602081810183526000808352835180830185528190528351808301855281905283518083018552819052835180830185528190528351808301855281905283518083018552818152845192830185528183528551875189518b518d51985197988e988e988e988e988e989097929691958695019091019091010190805910610d3a5750595b908082528060200260200182016040528015610d51575b50935083925060009150600090505b885181101561187557888181518110156100025790602001015160f860020a900460f860020a028383806001019450815181101561000257906020010190600160f860020a031916908160001a905350600101610d60565b60408051808201909152600180825260f860020a603b026020830152870154610de090610442565b604080518082019091526001815260f860020a603b0260208201526002890154610cb190610442565b565b6001909901986001909801976102bb565b60018981018054604080516020600295841615610100026000190190931694909404601f8101839004830285018301909152808452939a50610eda9390830182828015610f675780601f10610f3c57610100808354040283529160200191610f67565b604080518082019091526001815260f860020a603b0260208201525b604080516020818101835260008083528351808301855281815284518084018652828152855193840190955290825291926119f8928692869290610cb1565b600289810180546040805160206001841615610100026000190190931694909404601f8101839004830285018301909152808452939950610f8e9390830182828015610f675780601f10610f3c57610100808354040283529160200191610f67565b820191906000526020600020905b815481529060010190602001808311610f4a57829003601f168201915b5050604080518082019091526001815260f860020a603b0260208201529250610e9b915050565b9450610fa3610e7f8960030160005054610442565b9350610fb8610e7f8960040160005054610442565b9250610fcd610e7f8960050160005054610442565b9150610fe2610e7f8960060160005054610442565b9050610ff06110008d610442565b9c9b505050505050505050505050565b604080518082019091526001815260f860020a603b0260208201526110288a8a8a8a8a610cb1565b60078c018054604080516020601f60026000196101006001881615020190951694909404938401819004810282018101909252828152611094938a938a93830182828015610c795780601f10610c4e57610100808354040283529160200191610c79565b610c7f878787875b60206040519081016040528060008152602001506119ff858585856020604051908101604052806000815260200150610cb1565b50919050565b8495505b5050505050919050565b8585600202815181101561000257906020010190600160f860020a031916908160001a90535061110b816103bc565b8585600202600101815181101561000257906020010190600160f860020a031916908160001a9053506001909301926107e4565b8160f860020a900460570160f860020a0290505b919050565b8460018503815481101561000257906000526020600020906003020160005090506111898160020160005054610442565b95506110d2565b60405180806020018281038252838181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f1680156111f05780820380516001836020036101000a031916815260200191505b509250505060405180910390a1600180548a9081101561000257906000526020600020906008020160005060008a81526002602052604081208054929a50985090111561126f57865487906000198101908110156100025790600052602060002090600302016000509550348660020160005054111561126f57610002565b6003880154875460048a0154600a8304975060019091019550850201925082850191503482111561129f57610002565b8654156112fd578654879060001981019081101561000257600091825260208220885460028a015460405160039094029092019450600160a060020a0316926108fc8215029290818181858888f1935050505015156112fd57610002565b600089815260026020526040902080546001810180835582818380158290116113675760030281600302836000526020600020918201910161136791905b80821115610a8e578054600160a060020a0319168155600060018201819055600282015560030161133b565b5050509190906000526020600020906003020160005060408051606081018252338082524260208301819052349290930182905283546c0100000000000000000000000091820291909104600160a060020a0319909116178355600183019190915560029091015550505050505050505050565b5b600082111561048557600a808304920660300160f860020a02610100909104176113dc565b8360405180591061140f5750595b908082528060200260200182016040528015611426575b506000935090505b8383101561148257848381518110156100025790602001015160f860020a900460f860020a028184815181101561000257906020010190600160f860020a031916908160001a90535060019092019161142e565b8095506110d2565b8b54909a506114a590610e7f90600160a060020a0316610786565b60018c81018054604080516020600295841615610100026000190190931694909404601f8101839004830285018301909152808452939c506115089390830182828015610f675780601f10610f3c57610100808354040283529160200191610f67565b60028c810180546040805160206001841615610100026000190190931694909404601f8101839004830285018301909152808452939b5061156a9390830182828015610f675780601f10610f3c57610100808354040283529160200191610f67565b965061157f610e7f8c60030160005054610442565b9550611594610e7f8c60040160005054610442565b94506115a9610e7f8c60050160005054610442565b93506115be610e7f8c60060160005054610442565b60078c01805460408051602060026001851615610100026000190190941693909304601f8101849004840282018401909252818152939650610853939291830182828015610f675780601f10610f3c57610100808354040283529160200191610f67565b90506116358a61108c8b8b8b8b8b610cb1565b9d9c50505050505050505050505050565b9050611153565b60018054879081101561000257906000526020600020906008020160005060008781526002602052604081208054929750955090116116d9576040805160208082526015908201527f286c6f74426574732e6c656e677468203c3d2030290000000000000000000000818301529051600080516020611a088339815191529181900360600190a16108c8565b835484906000198101908110156100025760009182526020909120600390910201805490935033600160a060020a0390811691161461176557604080516020808252601d908201527f286c6173744265742e6f776e657220213d206d73672e73656e64657229000000818301529051600080516020611a088339815191529181900360600190a16108c8565b505060028101548354604051600a83046000198101930391600160a060020a03169082156108fc029083906000818181858888f1935050505015156117f757604080516020808252601e908201527f286c6f742e6f776e65722e73656e64287061796d656e74292920747275650000818301529051600080516020611a088339815191529181900360600190a16108c8565b604051600160a060020a0333169083156108fc029084906000818181858888f1935050505015156108c857604080516020808252601f908201527f286d73672e73656e6465722e73656e64286465706f7369742929207472756500818301529051600080516020611a088339815191529181900360600190a16108c8565b5060005b87518110156118d157878181518110156100025790602001015160f860020a900460f860020a028383806001019450815181101561000257906020010190600160f860020a031916908160001a905350600101611879565b5060005b865181101561192d57868181518110156100025790602001015160f860020a900460f860020a028383806001019450815181101561000257906020010190600160f860020a031916908160001a9053506001016118d5565b5060005b855181101561198957858181518110156100025790602001015160f860020a900460f860020a028383806001019450815181101561000257906020010190600160f860020a031916908160001a905350600101611931565b5060005b84518110156119e557848181518110156100025790602001015160f860020a900460f860020a028383806001019450815181101561000257906020010190600160f860020a031916908160001a90535060010161198d565b50909d9c50505050505050505050505050565b9392505050565b959450505050505641304facd9323d75b11bcdd609cb38effffdb05710f7caf0e9b16c6d9d709f50",
    "events": {
      "0x41304facd9323d75b11bcdd609cb38effffdb05710f7caf0e9b16c6d9d709f50": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "log",
            "type": "string"
          }
        ],
        "name": "log",
        "type": "event"
      }
    },
    "updated_at": 1479589459355,
    "links": {},
    "address": "0x75f8cc170f0bb9dbeefdc55c54d3c468166c0e15"
  },
  "default": {
    "abi": [
      {
        "constant": false,
        "inputs": [
          {
            "name": "title",
            "type": "string"
          },
          {
            "name": "photo",
            "type": "string"
          },
          {
            "name": "startPrice",
            "type": "uint256"
          },
          {
            "name": "step",
            "type": "uint256"
          },
          {
            "name": "duration",
            "type": "uint256"
          },
          {
            "name": "description",
            "type": "string"
          }
        ],
        "name": "addLot",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "_lotIndex",
            "type": "uint256"
          },
          {
            "name": "_betIndex",
            "type": "uint256"
          }
        ],
        "name": "getBet",
        "outputs": [
          {
            "name": "",
            "type": "string"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "kill",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "_index",
            "type": "uint256"
          }
        ],
        "name": "getTraderLot",
        "outputs": [
          {
            "name": "",
            "type": "string"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getTraderLotsAmount",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "x",
            "type": "address"
          }
        ],
        "name": "addressToString",
        "outputs": [
          {
            "name": "",
            "type": "string"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "b",
            "type": "bytes1"
          }
        ],
        "name": "char",
        "outputs": [
          {
            "name": "c",
            "type": "bytes1"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "_index",
            "type": "uint256"
          }
        ],
        "name": "getLastBet",
        "outputs": [
          {
            "name": "",
            "type": "string"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_index",
            "type": "uint256"
          }
        ],
        "name": "postBet",
        "outputs": [],
        "payable": true,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "v",
            "type": "uint256"
          }
        ],
        "name": "uintToBytes32",
        "outputs": [
          {
            "name": "ret",
            "type": "bytes32"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getAmountOfLots",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "x",
            "type": "bytes32"
          }
        ],
        "name": "bytes32ToString",
        "outputs": [
          {
            "name": "",
            "type": "string"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "_index",
            "type": "uint256"
          }
        ],
        "name": "getLot",
        "outputs": [
          {
            "name": "",
            "type": "string"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "input",
            "type": "uint256"
          }
        ],
        "name": "uintToString",
        "outputs": [
          {
            "name": "",
            "type": "string"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_index",
            "type": "uint256"
          }
        ],
        "name": "confirmDelivery",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "inputs": [],
        "type": "constructor"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "log",
            "type": "string"
          }
        ],
        "name": "log",
        "type": "event"
      }
    ],
    "unlinked_binary": "0x6060604052600080546c0100000000000000000000000033810204600160a060020a0319909116179055611a28806100376000396000f3606060405236156100b95760e060020a60003504631d7c4f8681146100be5780632301b83d146101cc57806341c0e1b5146102225780634debd9911461024f57806357dc50c6146103405780635e57966d146103a057806369f9ad2f146103b05780636f6d69d01461040857806380897d3b14610418578063886d3db91461048a5780638a58a1581461049a5780639201de55146104b5578063ab995d121461057a578063e93956791461062d578063fd84cb971461063d575b610002565b34610002576106e76004808035906020019082018035906020019191908080601f01602080910402602001604051908101604052809392919081815260200183838082843750506040805160208835808b0135601f81018390048302840183019094528383529799986044989297509190910194509092508291508401838280828437505060408051602060a435808b0135601f8101839004830284018301909452838352979998359860643598608435985090965060c49550919350602491909101919081908401838280828437509496505050505050506001805480820180835582818380158290116108d0576008028160080283600052602060002091820191016108d091906109a9565b34610002576106e9600435602435604080516020818101835260008083528581526002909152918220805491929184908110156100025790600052602060002090600302016000509050610c4661075784610442565b34610002576106e760005433600160a060020a0390811691161415610e0957600054600160a060020a0316ff5b34610002576106e960043560408051602081810183526000808352835180830185528181528451808401865282815285518085018752838152865180860188528481528751808701895285815288518088018a5286815289519788019099528587529697949687968796905b6001548910156100b95733600160a060020a031660016000508a815481101561000257906000526020600020906008020160005054600160a060020a03161415610e0b578b8a1415610e0b57600180548a908110156100025790600052602060002090600802016000508054909850610e1c90610e7f90600160a060020a0316610786565b34610002576104a3600080805b6001548110156110c85733600160a060020a0316600160005082815481101561000257906000526020600020906008020160005054600160a060020a03161415610398576001909101905b60010161034d565b34610002576106e9600435610786565b34610002576108366004355b60007f0a00000000000000000000000000000000000000000000000000000000000000600160f860020a03198316101561113f578160f860020a900460300160f860020a029050611153565b34610002576106e960043561085a565b6106e760043560006000600060006000600060006000600080516020611a08833981519152611190345b6040805160208101909152600081526116466104c1835b60008115156113db57507f30000000000000000000000000000000000000000000000000000000000000005b611153565b34610002576104a3600435610459565b34610002576001545b60408051918252519081900360200190f35b34610002576106e96004355b60408051602081810183526000808352835180830185528181528451808401865282815294519394909391928392839291908059106104fd5750595b908082528060200260200182016040528015610514575b50945060009350600092505b6020831015611401576008830260020a87029150600160f860020a031982161561056f57818585815181101561000257906020010190600160f860020a031916908160001a9053506001909301925b600190920191610520565b346100025760408051602080820183526000808352835180830185528181528451808401865282815285518085018752838152865180860188528481528751808701895285815288518088018a5286815289518089018b528781528a51808a018c528881528b51808b018d528981528c519a8b01909c52888a52600180546106e99d6004359d9c909290918e908110156100025790600052602060002090600802016000509a5061148a610e7f8e610442565b34610002576106e9600435610442565b34610002576106e760043560006000600060006000856001600050805490501080156106695750600086105b1561164d57604080516020808252602a908201527f286c6f74732e6c656e677468203c205f696e646578202626205f696e64657820818301527f3c2030292066616c73650000000000000000000000000000000000000000000060608201529051600080516020611a088339815191529181900360800190a16108c8565b005b60405180806020018281038252838181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f1680156107495780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b604080518082019091526001815260f860020a603b0260208201528354610c7f90610db890600160a060020a03165b60206040519081016040528060008152602001506020604051908101604052806000815260200150600060006000600060286040518059106107c55750595b9080825280602002602001820160405280156107dc575b509450600093505b60148410156110ce578360130360080260020a87600160a060020a03168115610002570460f860020a9081029350601081850460ff81168290048302945082850490910290030290506110dc826103bc565b60408051600160f860020a03199092168252519081900360200190f35b91506116228d5b6040805160208181018352600080835284815260029091529182208054919290919080808315156111585760018054889081101561000257600091825260209091206003600890920201908101546004820154919450600a8104910101915061118982610442565b50505050505b505050505050565b50505060009283526020808420604080516101008082018352338083528286018f9052928201899052606082018c9052608082018b90524260a083015260c082018a905260e082018d905260089096029092018054600160a060020a0319166c01000000000000000000000000928302929092049190911781558b5160018083018054818a529886902096989497939690956002928616159094026000190190941604601f90810183900484019391928e0190839010610ace57805160ff19168380011785555b50610afe929150610a7a565b50506008015b80821115610a8e578054600160a060020a031916815560018082018054600080835592600260001991831615610100029190910190911604601f819010610a6057505b5060028201600050805460018160011615610100020316600290046000825580601f10610a9257505b506000600383018190556004830181905560058301819055600683018190556007830180549181559060026101006001831615026000190190911604601f819010610ab057506109a3565b601f0160209004906000526020600020908101906109ec91905b80821115610a8e5760008155600101610a7a565b5090565b601f016020900490600052602060002090810190610a159190610a7a565b601f0160209004906000526020600020908101906109a39190610a7a565b82800160010185558215610997579182015b82811115610997578251826000505591602001919060010190610ae0565b50506040820151816002016000509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10610b5d57805160ff19168380011785555b50610b8d929150610a7a565b82800160010185558215610b51579182015b82811115610b51578251826000505591602001919060010190610b6f565b5050606082015160038201556080820151600482015560a0820151600582015560c0820151600682015560e0820151805160078301805460008281526020908190209294601f6002610100600186161502600019019094169390930483018290048401949392910190839010610c1657805160ff19168380011785555b506108c2929150610a7a565b82800160010185558215610c0a579182015b82811115610c0a578251826000505591602001919060010190610c28565b949350505050565b820191906000526020600020905b815481529060010190602001808311610c5c57829003601f168201915b50505050505b6040805160208181018352600080835283518083018552818152845192830190945281529091610c4691869186918691905b60408051602081810183526000808352835180830185528190528351808301855281905283518083018552819052835180830185528190528351808301855281905283518083018552818152845192830185528183528551875189518b518d51985197988e988e988e988e988e989097929691958695019091019091010190805910610d3a5750595b908082528060200260200182016040528015610d51575b50935083925060009150600090505b885181101561187557888181518110156100025790602001015160f860020a900460f860020a028383806001019450815181101561000257906020010190600160f860020a031916908160001a905350600101610d60565b60408051808201909152600180825260f860020a603b026020830152870154610de090610442565b604080518082019091526001815260f860020a603b0260208201526002890154610cb190610442565b565b6001909901986001909801976102bb565b60018981018054604080516020600295841615610100026000190190931694909404601f8101839004830285018301909152808452939a50610eda9390830182828015610f675780601f10610f3c57610100808354040283529160200191610f67565b604080518082019091526001815260f860020a603b0260208201525b604080516020818101835260008083528351808301855281815284518084018652828152855193840190955290825291926119f8928692869290610cb1565b600289810180546040805160206001841615610100026000190190931694909404601f8101839004830285018301909152808452939950610f8e9390830182828015610f675780601f10610f3c57610100808354040283529160200191610f67565b820191906000526020600020905b815481529060010190602001808311610f4a57829003601f168201915b5050604080518082019091526001815260f860020a603b0260208201529250610e9b915050565b9450610fa3610e7f8960030160005054610442565b9350610fb8610e7f8960040160005054610442565b9250610fcd610e7f8960050160005054610442565b9150610fe2610e7f8960060160005054610442565b9050610ff06110008d610442565b9c9b505050505050505050505050565b604080518082019091526001815260f860020a603b0260208201526110288a8a8a8a8a610cb1565b60078c018054604080516020601f60026000196101006001881615020190951694909404938401819004810282018101909252828152611094938a938a93830182828015610c795780601f10610c4e57610100808354040283529160200191610c79565b610c7f878787875b60206040519081016040528060008152602001506119ff858585856020604051908101604052806000815260200150610cb1565b50919050565b8495505b5050505050919050565b8585600202815181101561000257906020010190600160f860020a031916908160001a90535061110b816103bc565b8585600202600101815181101561000257906020010190600160f860020a031916908160001a9053506001909301926107e4565b8160f860020a900460570160f860020a0290505b919050565b8460018503815481101561000257906000526020600020906003020160005090506111898160020160005054610442565b95506110d2565b60405180806020018281038252838181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f1680156111f05780820380516001836020036101000a031916815260200191505b509250505060405180910390a1600180548a9081101561000257906000526020600020906008020160005060008a81526002602052604081208054929a50985090111561126f57865487906000198101908110156100025790600052602060002090600302016000509550348660020160005054111561126f57610002565b6003880154875460048a0154600a8304975060019091019550850201925082850191503482111561129f57610002565b8654156112fd578654879060001981019081101561000257600091825260208220885460028a015460405160039094029092019450600160a060020a0316926108fc8215029290818181858888f1935050505015156112fd57610002565b600089815260026020526040902080546001810180835582818380158290116113675760030281600302836000526020600020918201910161136791905b80821115610a8e578054600160a060020a0319168155600060018201819055600282015560030161133b565b5050509190906000526020600020906003020160005060408051606081018252338082524260208301819052349290930182905283546c0100000000000000000000000091820291909104600160a060020a0319909116178355600183019190915560029091015550505050505050505050565b5b600082111561048557600a808304920660300160f860020a02610100909104176113dc565b8360405180591061140f5750595b908082528060200260200182016040528015611426575b506000935090505b8383101561148257848381518110156100025790602001015160f860020a900460f860020a028184815181101561000257906020010190600160f860020a031916908160001a90535060019092019161142e565b8095506110d2565b8b54909a506114a590610e7f90600160a060020a0316610786565b60018c81018054604080516020600295841615610100026000190190931694909404601f8101839004830285018301909152808452939c506115089390830182828015610f675780601f10610f3c57610100808354040283529160200191610f67565b60028c810180546040805160206001841615610100026000190190931694909404601f8101839004830285018301909152808452939b5061156a9390830182828015610f675780601f10610f3c57610100808354040283529160200191610f67565b965061157f610e7f8c60030160005054610442565b9550611594610e7f8c60040160005054610442565b94506115a9610e7f8c60050160005054610442565b93506115be610e7f8c60060160005054610442565b60078c01805460408051602060026001851615610100026000190190941693909304601f8101849004840282018401909252818152939650610853939291830182828015610f675780601f10610f3c57610100808354040283529160200191610f67565b90506116358a61108c8b8b8b8b8b610cb1565b9d9c50505050505050505050505050565b9050611153565b60018054879081101561000257906000526020600020906008020160005060008781526002602052604081208054929750955090116116d9576040805160208082526015908201527f286c6f74426574732e6c656e677468203c3d2030290000000000000000000000818301529051600080516020611a088339815191529181900360600190a16108c8565b835484906000198101908110156100025760009182526020909120600390910201805490935033600160a060020a0390811691161461176557604080516020808252601d908201527f286c6173744265742e6f776e657220213d206d73672e73656e64657229000000818301529051600080516020611a088339815191529181900360600190a16108c8565b505060028101548354604051600a83046000198101930391600160a060020a03169082156108fc029083906000818181858888f1935050505015156117f757604080516020808252601e908201527f286c6f742e6f776e65722e73656e64287061796d656e74292920747275650000818301529051600080516020611a088339815191529181900360600190a16108c8565b604051600160a060020a0333169083156108fc029084906000818181858888f1935050505015156108c857604080516020808252601f908201527f286d73672e73656e6465722e73656e64286465706f7369742929207472756500818301529051600080516020611a088339815191529181900360600190a16108c8565b5060005b87518110156118d157878181518110156100025790602001015160f860020a900460f860020a028383806001019450815181101561000257906020010190600160f860020a031916908160001a905350600101611879565b5060005b865181101561192d57868181518110156100025790602001015160f860020a900460f860020a028383806001019450815181101561000257906020010190600160f860020a031916908160001a9053506001016118d5565b5060005b855181101561198957858181518110156100025790602001015160f860020a900460f860020a028383806001019450815181101561000257906020010190600160f860020a031916908160001a905350600101611931565b5060005b84518110156119e557848181518110156100025790602001015160f860020a900460f860020a028383806001019450815181101561000257906020010190600160f860020a031916908160001a90535060010161198d565b50909d9c50505050505050505050505050565b9392505050565b959450505050505641304facd9323d75b11bcdd609cb38effffdb05710f7caf0e9b16c6d9d709f50",
    "events": {
      "0x41304facd9323d75b11bcdd609cb38effffdb05710f7caf0e9b16c6d9d709f50": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "log",
            "type": "string"
          }
        ],
        "name": "log",
        "type": "event"
      }
    },
    "updated_at": 1479584580239
  }
};

  Contract.checkNetwork = function(callback) {
    var self = this;

    if (this.network_id != null) {
      return callback();
    }

    this.web3.version.network(function(err, result) {
      if (err) return callback(err);

      var network_id = result.toString();

      // If we have the main network,
      if (network_id == "1") {
        var possible_ids = ["1", "live", "default"];

        for (var i = 0; i < possible_ids.length; i++) {
          var id = possible_ids[i];
          if (Contract.all_networks[id] != null) {
            network_id = id;
            break;
          }
        }
      }

      if (self.all_networks[network_id] == null) {
        return callback(new Error(self.name + " error: Can't find artifacts for network id '" + network_id + "'"));
      }

      self.setNetwork(network_id);
      callback();
    })
  };

  Contract.setNetwork = function(network_id) {
    var network = this.all_networks[network_id] || {};

    this.abi             = this.prototype.abi             = network.abi;
    this.unlinked_binary = this.prototype.unlinked_binary = network.unlinked_binary;
    this.address         = this.prototype.address         = network.address;
    this.updated_at      = this.prototype.updated_at      = network.updated_at;
    this.links           = this.prototype.links           = network.links || {};
    this.events          = this.prototype.events          = network.events || {};

    this.network_id = network_id;
  };

  Contract.networks = function() {
    return Object.keys(this.all_networks);
  };

  Contract.link = function(name, address) {
    if (typeof name == "function") {
      var contract = name;

      if (contract.address == null) {
        throw new Error("Cannot link contract without an address.");
      }

      Contract.link(contract.contract_name, contract.address);

      // Merge events so this contract knows about library's events
      Object.keys(contract.events).forEach(function(topic) {
        Contract.events[topic] = contract.events[topic];
      });

      return;
    }

    if (typeof name == "object") {
      var obj = name;
      Object.keys(obj).forEach(function(name) {
        var a = obj[name];
        Contract.link(name, a);
      });
      return;
    }

    Contract.links[name] = address;
  };

  Contract.contract_name   = Contract.prototype.contract_name   = "contract";
  Contract.generated_with  = Contract.prototype.generated_with  = "3.2.0";

  // Allow people to opt-in to breaking changes now.
  Contract.next_gen = false;

  var properties = {
    binary: function() {
      var binary = Contract.unlinked_binary;

      Object.keys(Contract.links).forEach(function(library_name) {
        var library_address = Contract.links[library_name];
        var regex = new RegExp("__" + library_name + "_*", "g");

        binary = binary.replace(regex, library_address.replace("0x", ""));
      });

      return binary;
    }
  };

  Object.keys(properties).forEach(function(key) {
    var getter = properties[key];

    var definition = {};
    definition.enumerable = true;
    definition.configurable = false;
    definition.get = getter;

    Object.defineProperty(Contract, key, definition);
    Object.defineProperty(Contract.prototype, key, definition);
  });

  bootstrap(Contract);

  if (typeof module != "undefined" && typeof module.exports != "undefined") {
    module.exports = Contract;
  } else {
    // There will only be one version of this contract in the browser,
    // and we can use that.
    window.Auction = Contract;
  }
})();
