const HotPocket = require('hotpocket-nodejs-contract');
const sodium = require('libsodium-wrappers-sumo');
const fs = require('fs');
const crypto = require('node:crypto');

const opfile = "../opinion.txt";

const FILE_PATH = '../rep_hash.dat';
const TOTAL_FILE_SIZE = 1.5 * 1024 * 1024 * 1024;//25 * 1024 * 1024 * 1024 ;
const WRITE_INTERVAL = 1 * 512 * 1024; //10 * 1024 * 1024;
const CHUNK_SIZE = 1024 * 1024; // 1024 * 1024;

const NUM_HASHES = TOTAL_FILE_SIZE / WRITE_INTERVAL;

const SODIUM_FREQUENCY = 200;
const PWHASH_MEM_LIMIT = 300 * 1024 * 1024; //For testing with lower resource consumption. Recommended value: 682 * 1024 * 1024;

const OPINION_WRITE_WAIT = 5000;

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
                console.log("File initialized completed.");
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

                console.log('Hash file percentage:', (startPosition / TOTAL_FILE_SIZE * 100).toFixed(2), '%');
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

    await sodium.ready;

    let good = {};

    let [fileHash, pubKeyCodedHash] = [null, null];

    let storedMessages = [];

    ctx.unl.onMessage(async (node, msg) => {
        if (!fileHash) {
            storedMessages.push({ node, msg });
            console.log(`Message from ${node.publicKey} stored.`);
            return;
        } else {
            const pubKeyCodedHash = getPubKeyCodedHash(node.publicKey, fileHash);
            console.log(`Message received from ${node.publicKey}`)
            if (pubKeyCodedHash == msg) {
                good[node.publicKey] = 1;
            }
        }
    });

    [fileHash, pubKeyCodedHash] = await pow(ctx.lclHash, ctx.publicKey);
    console.log(`\nfileHash generation complete:${fileHash}`);

    console.log(`\nProcessing previously received messages (${storedMessages.length}) `);
    for (const { node, msg } of storedMessages) {
        const pubKeyCodedHash = getPubKeyCodedHash(node.publicKey, fileHash);

        if (pubKeyCodedHash == msg) {
            good[node.publicKey] = 1;
        }
    }

    console.log(`\nSending pubKeyCodedHash.`)
    await ctx.unl.send(pubKeyCodedHash);
    console.log(`\npubKeyCodedHash sent.`)

    await new Promise((resolve) => {
        setTimeout(() => {
            try {
                if (!fs.existsSync(opfile)) {
                    console.log("\nCreating optfile:");
                    console.log(JSON.stringify(good) + "\n");
                    fs.appendFileSync(opfile, JSON.stringify(good));
                    console.log("\nOptfile created successfully.");
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
                console.log("\nOptfile updated successfully.");
                return resolve();
            } catch (e) {
                console.error(e);
                resolve();
            }
        }, OPINION_WRITE_WAIT);
    });
};

const hpc = new HotPocket.Contract();
hpc.init(myContract, null, true);
