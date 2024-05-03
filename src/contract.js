const HotPocket = require('hotpocket-nodejs-contract');
const sodium = require('libsodium-wrappers-sumo');
const fs = require('fs');
const reqsevens = 1;

const tsfile = "timestamps.txt";
const opfile = "../opinion.txt";
const memLimit = 100 * 1024 * 1024; //For testing with lower resource consumption. Recommended value: 682 * 1024 * 1024;

function generateHash(lgrhex, pubkeyhex, uptohex) {
    const buf = Buffer.from(lgrhex + pubkeyhex + uptohex, "hex").toString("hex");
    const salt = Uint8Array.from(uptohex + lgrhex).slice(0, sodium.crypto_pwhash_SALTBYTES);

    return sodium.crypto_pwhash(
        sodium.crypto_pwhash_STRBYTES >>> 0,
        buf,
        salt,
        sodium.crypto_pwhash_OPSLIMIT_MIN >>> 0,
        memLimit,
        sodium.crypto_pwhash_ALG_DEFAULT
    ).toString('hex');
}

async function pow(lgrhex, pubkeyhex, sevens) {
    const t0 = performance.now();
    for (let upto = 0n; upto < 0xFFFFFFFFFFFFFFFFn; upto++) {

        let uptohex = upto.toString(16);
        if (uptohex.length < 16)
            uptohex = '0'.repeat(16 - uptohex.length) + uptohex;

        const startTime = performance.now();

        let sha = generateHash(lgrhex, pubkeyhex, uptohex);

        const endTime = performance.now();

        const timeTaken = endTime - startTime;

        let i = 0;
        for (; i < sevens && i < sha.length; ++i) {
            if (sha.charCodeAt(i) == 55) {
                if (i >= sevens - 1) {
                    return uptohex;
                }
            }
            else break;
        }
    }

    // this failure case will never happen but cover it anyway
    return '0'.repeat(16);
}

async function countsevens(lgrhex, pubkeyhex, uptohex) {
    let sha = generateHash(lgrhex, pubkeyhex, uptohex);

    for (let i = 0; i < sha.length; ++i) {
        if (sha.charCodeAt(i) != 55) {
            return i + 1;
        }
    }
    return sha.length;
}

// Contract logic.
const myContract = async (ctx) => {
    if (ctx.readonly) {
        for (const user of ctx.users.list()) {
            console.log("User public key", user.publicKey);

            // Loop through inputs sent by each user.
            for (const input of user.inputs) {
                const buffer = await ctx.users.read(input);

                const message = buffer.toString();
                const req = JSON.parse(message);

                if (req.command === 'read_scores') {
                    const output = fs.existsSync(opfile) ? JSON.parse(fs.readFileSync(opfile).toString()) : null;
                    user.send({ message: output });
                }
            }
        }

        return;
    }

    fs.appendFileSync(tsfile, ctx.timestamp + "\n");

    await sodium.ready;

    let good = {};

    ctx.unl.onMessage(async (node, msg) => {
        let sev = await countsevens(ctx.lclHash, node.publicKey, msg);
        if (sev >= reqsevens)
            good[node.publicKey] = 1;
    });

    await ctx.unl.send(await pow(ctx.lclHash, ctx.publicKey, reqsevens));


    // wait 3 seconds
    await new Promise((resolve) => {
        setTimeout(() => {
            // write out our opinions

            try {
                if (!fs.existsSync(opfile)) {
                    console.log("\nCreating optfile:");
                    console.log(JSON.stringify(good) + "\n");
                    fs.appendFileSync(opfile, JSON.stringify(good));
                    return resolve();
                }

                let ops = JSON.parse(Buffer.from(fs.readFileSync(opfile), 'utf-8'));
                for (k in good) {
                    if (k in ops)
                        ops[k]++;
                    else
                        ops[k] = 1;
                }
                console.log("\nUpdating optfile:");
                console.log(JSON.stringify(ops) + "\n");
                fs.writeFileSync(opfile, JSON.stringify(ops));
                return resolve();
            } catch (e) {
                console.error(e);
                resolve();
            }
        }, 3000);
    });
};

const hpc = new HotPocket.Contract();
hpc.init(myContract, null, true);
