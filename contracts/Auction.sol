pragma solidity ^0.4.2;

contract mortal {
    /* Define variable owner of the type address*/
    address owner;

    /* this function is executed at initialization and sets the owner of the contract */
    function mortal() { owner = msg.sender; }

    /* Function to recover the funds on the contract */
    function kill() { if (msg.sender == owner) selfdestruct(owner); }

    function uintToBytes32(uint v) constant returns (bytes32 ret) {
        if (v == 0) {
            ret = '0';
        }
        else {
            while (v > 0) {
                ret = bytes32(uint(ret) / (2 ** 8));
                ret |= bytes32(((v % 10) + 48) * 2 ** (8 * 31));
                v /= 10;
            }
        }
        return ret;
    }

		function char(byte b) returns (byte c) {
				if (b < 10) return byte(uint8(b) + 0x30);
				else return byte(uint8(b) + 0x57);
		}

    function addressToString(address x) returns (string) {
        bytes memory s = new bytes(40);
        for (uint i = 0; i < 20; i++) {
            byte b = byte(uint8(uint(x) / (2**(8*(19 - i)))));
            byte hi = byte(uint8(b) / 16);
            byte lo = byte(uint8(b) - 16 * uint8(hi));
            s[2*i] = char(hi);
            s[2*i+1] = char(lo);
        }
        return string(s);
    }

    function bytes32ToString(bytes32 x) constant returns (string) {
        bytes memory bytesString = new bytes(32);
        uint charCount = 0;
        for (uint j = 0; j < 32; j++) {
            byte char = byte(bytes32(uint(x) * 2 ** (8 * j)));
            if (char != 0) {
                bytesString[charCount] = char;
                charCount++;
            }
        }
        bytes memory bytesStringTrimmed = new bytes(charCount);
        for (j = 0; j < charCount; j++) {
            bytesStringTrimmed[j] = bytesString[j];
        }
        return string(bytesStringTrimmed);
    }

		function uintToString(uint input) constant returns (string)  {
			return bytes32ToString(uintToBytes32(input));
		}

    function concat5(string _a, string _b, string _c, string _d, string _e) internal returns (string){
        bytes memory _ba = bytes(_a);
        bytes memory _bb = bytes(_b);
        bytes memory _bc = bytes(_c);
        bytes memory _bd = bytes(_d);
        bytes memory _be = bytes(_e);
        string memory abcde = new string(_ba.length + _bb.length + _bc.length + _bd.length + _be.length);
        bytes memory babcde = bytes(abcde);
        uint k = 0;
        for (uint i = 0; i < _ba.length; i++) babcde[k++] = _ba[i];
        for (i = 0; i < _bb.length; i++) babcde[k++] = _bb[i];
        for (i = 0; i < _bc.length; i++) babcde[k++] = _bc[i];
        for (i = 0; i < _bd.length; i++) babcde[k++] = _bd[i];
        for (i = 0; i < _be.length; i++) babcde[k++] = _be[i];
        return string(babcde);
    }

    function concat4(string _a, string _b, string _c, string _d) internal returns (string) {
        return concat5(_a, _b, _c, _d, "");
    }

    function concat3(string _a, string _b, string _c) internal returns (string) {
        return concat5(_a, _b, _c, "", "");
    }

    function concat2(string _a, string _b) internal returns (string) {
        return concat5(_a, _b, "", "", "");
    }
}

contract Auction is mortal {

	event log(string log); // LOGGING EVENT

	struct Lot {
		address owner;
		string title;
		string description;
		uint startPrice;
		uint step;
    uint startTime;
		uint duration;
		string photo;
	}

	struct Bet {
		address owner;
		uint betTime;
		uint value;
	}

	Lot[] lots;
	mapping(uint => Bet[]) bets;

	function Auction() {

	}

	function addLot(string title,
									string photo,
									uint startPrice,
									uint step,
									uint duration,
									string description)
	{
		lots.push(Lot(msg.sender,
														title,
														description,
												 		startPrice,
												  	step,
                            now,
													 	duration,
													 	photo));
	}

	function getAmountOfLots() constant returns (uint) {
		return lots.length;
	}

	function char(byte b) returns (byte c) {
		if (b < 10) return byte(uint8(b) + 0x30);
		else return byte(uint8(b) + 0x57);
	}

  function getLastBet(uint _index) constant returns (string) {
		Bet[] lotBets = bets[_index];
    var len = lotBets.length;
		if(len == 0){
      Lot lot = lots[_index];
      var preferredBet = lot.startPrice + lot.step + lot.startPrice / 10;
      return uintToString(preferredBet);
    }
		Bet bet = lotBets[len - 1];
		return uintToString(bet.value);
	}

	function getLot(uint _index) constant returns (string) {
		Lot lot = lots[_index];

		var idx = concat2(uintToString(_index), ";");
		var owner = concat2(addressToString(lot.owner), ";");
		var title = concat2(lot.title, ";");
		var description = concat2(lot.description, ";");
		var startPrice = concat2(uintToString(lot.startPrice), ";");
		var step = concat2(uintToString(lot.step), ";");
		var startTime = concat2(uintToString(lot.startTime), ";");
		var duration = concat2(uintToString(lot.duration), ";");
		var photo = concat2(lot.photo, ";");
		var lastBet = getLastBet(_index);

		return concat3(idx,
				concat5(owner, title, description, startPrice, step),
				concat4(startTime, duration, photo, lastBet));
	}
	function getTraderLotsAmount() constant returns (uint) {
		uint count = 0;
		for(uint i = 0 ; i < lots.length; i++)
			if(lots[i].owner == msg.sender) count++;
		return count;
	}

	function getTraderLot(uint _index) constant returns (string) {
		uint count = 0;
		for(uint i = 0 ; i < lots.length; i++){
			if(lots[i].owner == msg.sender)
				if(count == _index){
					Lot lot = lots[i];

					var owner = concat2(addressToString(lot.owner), ";");
					var title = concat2(lot.title, ";");
					var description = concat2(lot.description, ";");
					var startPrice = concat2(uintToString(lot.startPrice), ";");
					var step = concat2(uintToString(lot.step), ";");
					var startTime = concat2(uintToString(lot.startTime), ";");
					var duration = concat2(uintToString(lot.duration), ";");

					return concat4(uintToString(_index), ";", concat5(owner, title, description, startPrice, step), concat3(startTime, duration, lot.photo));
				}

				count++;
		}
		throw;
	}

	function postBet(uint _index) payable {
		log(uintToString(msg.value));

		Lot lot = lots[_index];
		Bet[] lotBets = bets[_index];

		// checking lot duration
		// if(now > lot.startTime + lot.duration)
		//	throw;

		// compare last bet and pending
		if (lotBets.length > 0) {
			Bet last = lotBets[lotBets.length-1];
			if(last.value > msg.value)
				throw;
		}

		// checking deposit
		var deposit = lot.startPrice / 10;
		var step = lotBets.length + 1;
		var currentPriceWithoutDeposit = lot.startPrice + step * lot.step;
		var currentPrice = currentPriceWithoutDeposit + deposit;

		if(currentPrice > msg.value)
			throw;

		// return to last betting guys his funds
		if(lotBets.length != 0) {
			Bet lastBet = lotBets[lotBets.length-1];
			if(!last.owner.send(last.value))
				throw;
		}

		// adding bet
		bets[_index].push(Bet(msg.sender, now, msg.value));
	}

	function getBet(uint _lotIndex, uint _betIndex) constant returns (string) {
		Bet bet = bets[_lotIndex][_betIndex];
		return concat3(uintToString(_betIndex), ";",concat5(addressToString(bet.owner), ";", uintToString(bet.betTime), ";",  uintToString(bet.value)));
	}

	function confirmDelivery(uint _index) {
		if(lots.length < _index && _index < 0){
			log("(lots.length < _index && _index < 0) false");
			return;
		}

		Lot lot = lots[_index];

		// checking lot duration
		/*if(now < lot.startTime + lot.duration){
			log("(now < lot.startTime + lot.duration)");
			throw;
		}*/


		// checking bets is more then 0 :D
		Bet[] lotBets = bets[_index];
		if(lotBets.length <= 0) {
			log("(lotBets.length <= 0)");
			return;
		}

		// checking that your bet is last
		Bet lastBet = lotBets[lotBets.length-1];
		if(lastBet.owner != msg.sender) {
			log("(lastBet.owner != msg.sender)");
			return;
		}

		// eval deposit to return to customer
		var deposit = (lastBet.value / 10) - 1;
		// eval payment for trader
		var payment = (lastBet.value - deposit) - 1;

		if(!lot.owner.send(payment)) {
			log("(lot.owner.send(payment)) true");
			return;
		}

		if(!msg.sender.send(deposit)) {
			log("(msg.sender.send(deposit)) true");
			return;
		}
	}
}
