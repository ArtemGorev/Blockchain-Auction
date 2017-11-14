let Auction = artifacts.require("./Auction.sol");

contract('contract', async function (accounts) {
    let account = accounts[0];
    let options = {from: account};

    let auction;

    before(async () => {
        auction = await Auction.new();
    });


    it("should create lot and return it", async function () {

        return auction.addLot("VASYANS DUSHA", "www.ya.ru", 1e18, 1e18, 100, "THIS IS A VASYAN'S DUSHA", options)
            .then(function (response) {

                console.log("addLot response", response);
                return auction.getAmountOfLots.call(options);
            }).then(function (response) {

                console.log("getAmountOfLots response", response);
                assert.equal(response.toNumber(), 1, "can't return truly amount of lots");
                return auction.getLot.call(0, options);
            }).then(function (response) {
                console.log(`arrr ${response}`);

                let arrr = response.split(";");

                assert.equal(arrr[0], "0", "can't return truly body of lot");
                assert.equal(arrr[2], "VASYANS DUSHA", "can't return truly body of lot");
                assert.equal(arrr[3], "THIS IS A VASYAN'S DUSHA", "can't return truly body of lot");
                assert.equal(arrr[4], 1e18, "can't return truly body of lot");
                assert.equal(arrr[5], 1e18, "can't return truly body of lot");
                assert.equal(arrr[7], 100, "can't return truly body of lot");
                assert.equal(arrr[8], "www.ya.ru", "can't return truly body of lot");

                console.log("getLot response ", response);
            });
    });

    it("should post a bet and return lot with bet", async function () {
        let contract = auction;

        options.value = 12e18;
        return contract.postBet(0, options).then(function (response) {
            console.log("postBet " + response);
            // check that bet was posted
            options.value = 0;
            // in: index of lot, index of bet
            // out: return bet
            return contract.getBet.call(0, 0, options);
        }).then(function (response) {
            console.log("getBet " + response);

            let arrr = response.split(";");
            assert.equal(arrr[0], 0, "returned failed bet");
            assert.equal(arrr[3], 12e18, "returned failed bet");
        });
    });

    it("should post a wrong bet and get an exception", async function () {
        let contract = auction;
        options.value = 10e18;
        return contract.postBet(0, options).then(function (response) {
            console.log("postBet " + response);
            // check that bet was posted
            options.value = 0;
            // in: index of lot, index of bet
            // out: return bet
            return contract.getBet.call(0, 0, options);
        }).catch(function (exception) {
            console.log("exception = " + exception);
        });
    });

    it("should post a highest bet and checking return value", async function () {
        let contract = auction;

        options.from = accounts[1];
        options.value = 13e18;
        return contract.postBet(0, options).then(function (response) {
            console.log("postBet " + response);
            // check that bet was posted
            options.value = 0;
            // in: index of lot, index of bet
            // out: return bet
            return contract.getBet.call(0, 1, options);
        }).then(function (response) {
            console.log("getBet response = " + response);
        });
    });

    it("should get traders lots and be cool guy", async function () {
        let contract = auction;

        options.from = accounts[0];
        options.value = 0;

        return contract.getTraderLotsAmount.call(options).then(function (response) {
            let count = response.toNumber();
            assert.equal(count, 1);

            return contract.getTraderLot.call(0, options);
        }).then(function (response) {
            console.log("response " + response);

            let arrr = response.split(";");

            assert.equal(arrr[0], "0", "can't return truly body of lot");
            assert.equal(arrr[2], "VASYANS DUSHA", "can't return truly body of lot");
            assert.equal(arrr[3], "THIS IS A VASYAN'S DUSHA", "can't return truly body of lot");
            assert.equal(arrr[4], 1e18, "can't return truly body of lot");
            assert.equal(arrr[5], 1e18, "can't return truly body of lot");
            assert.equal(arrr[7], 100, "can't return truly body of lot");
            assert.equal(arrr[8], "www.ya.ru", "can't return truly body of lot");
        });
    });

    it("should finish payment", async function () {
        let contract = auction;

        options.from = accounts[1];
        options.value = 0;
        let _index = 0;
        return contract.confirmDelivery(_index).then(function (response) {
            console.log("confirmDelivery response " + response);
        });
    });

    it("should get lot with latest bet", async function () {
        let contract = auction;

        options.from = accounts[0];
        options.value = 0;
        return contract.getLot.call(0, options).then(function (response) {
            console.log("getLot with latest bet" + response);
        });
    });
    // done
});
