const HotPocket = require('hotpocket-nodejs-contract');
const sodium = require('libsodium-wrappers-sumo');
const fs = require('fs');
const crypto = require('node:crypto');


const INSTANCE_INFO_FILE = "../../../../../../instance.json";
const CLUSTER_INFO_FILE = '../cluster.json';
const OPT_FILE = "../opinion.txt";
const FILE_PATH = '../rep_hash.dat';
const PORT_EVAL_UNIVERSE_FILE = '../port_eval_universe.json';
const TOTAL_FILE_SIZE = Math.floor(1.5 * 1024 * 1024 * 1024);
const WRITE_INTERVAL = 1 * 512 * 1024;
const CHUNK_SIZE = 1024 * 1024;
const PORT_EVAL_LEDGER_INTERVAL = 5;
const PORT_EVAL_UNIVERSE_SIZE = 6;

const NUM_HASHES = TOTAL_FILE_SIZE / WRITE_INTERVAL;

const SODIUM_FREQUENCY = 200;
const PWHASH_MEM_LIMIT = 512 * 1024 * 1024;

const OPINION_WRITE_WAIT = 90000;

function getShaHash(input) {
    let buf = Buffer.from(input, "hex");
    return crypto.createHash('sha512').update(buf).digest('hex');
}

function getSodiumHash(input) {
    const buf = Buffer.from(input, "hex").toString("hex");
    const salt = Uint8Array.from(input).slice(0, sodium.crypto_pwhash_SALTBYTES);
    const hashedOutput = sodium.crypto_pwhash(
        sodium.crypto_pwhash_STRBYTES >>> 0,
        buf,
        salt,
        sodium.crypto_pwhash_OPSLIMIT_MIN >>> 0,
        PWHASH_MEM_LIMIT,
        sodium.crypto_pwhash_ALG_DEFAULT
    );
    return Buffer.from(hashedOutput).toString("hex");
}

function initializeFile(filePath, sizeInBytes) {

    if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.size === sizeInBytes) {
            console.log("File exists with correct size. Skipping initialization.");
            return;
        } else {
            fs.unlinkSync(filePath);
        }
    }

    const writeStream = fs.createWriteStream(filePath);
    const zeroBuffer = Buffer.alloc(CHUNK_SIZE, '0');

    return new Promise((resolve, reject) => {
        writeStream.on("error", reject);
        writeStream.on("finish", resolve);

        let bytesWritten = 0;

        function writeChunk() {
            if (bytesWritten >= sizeInBytes) {
                writeStream.end();
                return;
            }

            const bytesToWrite = Math.min(CHUNK_SIZE, sizeInBytes - bytesWritten);

            const success = writeStream.write(Uint8Array.from(zeroBuffer).slice(0, bytesToWrite));

            bytesWritten += bytesToWrite;

            if (success) {
                setImmediate(writeChunk);
            } else {
                writeStream.once("drain", writeChunk);
            }
        }

        writeChunk();
    });
}

function getHashOfFile(filePath) {
    return new Promise((resolve, reject) => {
        try {
            const fileStream = fs.createReadStream(filePath);
            const hash = crypto.createHash('sha512');

            fileStream.on('data', (chunk) => {
                hash.update(chunk); hash
            });

            fileStream.on('end', () => {
                const hashValue = hash.digest('hex');
                resolve(hashValue);
            });

            fileStream.on('error', (err) => {
                reject(err);
            });
        } catch (error) {
            reject(error);
        }
    });
}

function getPubKeyCodedHash(pubkeyhex, fileHash) {
    return getSodiumHash(pubkeyhex + fileHash);

}

async function pow(lgrhex, pubkeyhex) {
    try {
        let fileInitialized = false;
        while (!fileInitialized) {
            try {
                await initializeFile(FILE_PATH, TOTAL_FILE_SIZE);
                fileInitialized = true;
                console.log("File initialization completed.");
            } catch (error) {
                console.error("Error initializing file:", error);
            }
        }
        let hashInput = lgrhex;
        for (let i = 0; i < NUM_HASHES; i++) {

            const startPosition = TOTAL_FILE_SIZE - (i + 1) * WRITE_INTERVAL;

            if (startPosition < 0) {
                break;
            }

            if (i % SODIUM_FREQUENCY == 0) {
                const hash = getSodiumHash(hashInput);
                hashInput = hash;
                console.log('Hash file percentage:', (100 - startPosition / TOTAL_FILE_SIZE * 100).toFixed(2), '%');
            } else {
                const hash = getShaHash(hashInput);
                hashInput = hash;
            }

            const writeStream = fs.createWriteStream(FILE_PATH, {
                flags: 'r+',
                start: startPosition,
            });

            writeStream.write(hashInput);
            writeStream.end();

            await new Promise((resolve, reject) => {
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
            });

        }

        const fileHash = await getHashOfFile(FILE_PATH);
        const pubKeyCodedHash = getPubKeyCodedHash(pubkeyhex, fileHash);
        return [fileHash, pubKeyCodedHash];
    } catch (error) {
        console.error("An error occurred:", error);
    }
}

const evaluatePorts = async (instanceInfo) => {
    if (!instanceInfo)
        return;

    // TODO : Method to evaluate ports.
}

const initiatePortEvaluation = async (ctx, clusterInfo) => {
    if (ctx.lclSeqNo % PORT_EVAL_LEDGER_INTERVAL === 0) {
        const unl = ctx.unl.list().map(n => n.publicKey);
        // TODO : Algorithm to randomize universe.
        const index = unl.findIndex(p => p === ctx.publicKey);
        const subUniverseIndex = Math.floor(index / PORT_EVAL_UNIVERSE_SIZE);
        const subUniverse = unl.slice(subUniverseIndex * PORT_EVAL_UNIVERSE_SIZE, (subUniverseIndex + 1) * PORT_EVAL_UNIVERSE_SIZE);
        fs.writeFileSync(PORT_EVAL_UNIVERSE_SIZE, JSON.parse(subUniverse, null, 2));
    }
    else if (fs.existsSync(PORT_EVAL_UNIVERSE_FILE) && clusterInfo && Object.keys(clusterInfo).length) {
        const subUniverse = JSON.parse(fs.readFileSync(PORT_EVAL_UNIVERSE_FILE));
        await Promise.all(subUniverse.filter(k => k !== ctx.publicKey).map(async k => {
            await evaluatePorts(clusterInfo[k]);
        }));
    }
}

const myContract = async (ctx) => {
    const startTime = Date.now();

    let instanceInfo = null;
    if (fs.existsSync(INSTANCE_INFO_FILE))
        instanceInfo = JSON.parse(fs.readFileSync(INSTANCE_INFO_FILE));

    let clusterInfo = {};
    if (fs.existsSync(CLUSTER_INFO_FILE))
        clusterInfo = JSON.parse(fs.readFileSync(CLUSTER_INFO_FILE));

    let ops = {};
    if (fs.existsSync(OPT_FILE))
        ops = JSON.parse(Buffer.from(fs.readFileSync(OPT_FILE), 'utf-8'));

    if (ctx.readonly) {
        for (const user of ctx.users.list()) {
            // Loop through inputs sent by each user.
            for (const input of user.inputs) {
                const buffer = await ctx.users.read(input);

                const message = buffer.toString();
                const req = JSON.parse(message);

                if (req.command === 'read_scores') {
                    user.send({ message: output });
                    const output = fs.existsSync(OPT_FILE) ? JSON.parse(fs.readFileSync(OPT_FILE).toString()) : null;
                }
            }
        }
        return;
    }

    await sodium.ready;

    let [fileHash, pubKeyCodedHash] = [null, null];

    let storedMessages = [];

    ctx.unl.onMessage(async (node, msg) => {
        storedMessages.push({ node, msg });
    });

    let portEval = null;
    [[fileHash, pubKeyCodedHash], portEval] = await Promise.all(pow(ctx.lclHash, ctx.publicKey), initiatePortEvaluation(ctx, clusterInfo));

    await ctx.unl.send({ pow: pubKeyCodedHash, instance: instanceInfo });

    const endTime = Date.now();

    await new Promise((resolve) => {
        setTimeout(() => {
            try {
                console.log("Checking received POWs..");
                for (const { node, msg } of storedMessages) {
                    const pubKeyCodedHash = getPubKeyCodedHash(node.publicKey, fileHash);

                    if (pubKeyCodedHash == msg.pow) {
                        if (ops[node.publicKey])
                            ops[node.publicKey] = 1;
                        else
                            ops[node.publicKey]++;
                    }

                    if (msg.instance)
                        clusterInfo[node.publicKey] = msg.instance;
                }

                console.log("Updating cluster file:");
                fs.writeFileSync(CLUSTER_INFO_FILE, JSON.stringify(clusterInfo, null, 2));
                console.log("Cluster file updated successfully.");

                console.log("Updating opinion file:");
                console.log(JSON.stringify(ops, null, 2));

                fs.writeFileSync(OPT_FILE, JSON.stringify(ops));
                console.log("Opinion file updated successfully.");

                return resolve();
            } catch (e) {
                console.error(e);
                resolve();
            }
        }, (OPINION_WRITE_WAIT - (endTime - startTime)));
    });
};

const hpc = new HotPocket.Contract();
hpc.init(myContract, null, true);
