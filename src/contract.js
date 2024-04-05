const HotPocket = require("hotpocket-nodejs-contract");

const contract = async (ctx) => {
    console.log('Reputation contract');
}

const hpc = new HotPocket.Contract();
hpc.init(contract);