const HotPocket = require('hotpocket-nodejs-contract');
const sodium = require('libsodium-wrappers-sumo');
const fs = require('fs');
const crypto = require('node:crypto');
const dgram = require('dgram');
const WebSocket = require('ws');

const HP_LOG_FILE = "../../../../log/hp.log";
const CONTRACT_OUT_FILE = "../../../../log/contract/rw.stdout.log";
const CONTRACT_ERR_FILE = "../../../../log/contract/rw.stderr.log";
const INSTANCE_INFO_FILE = "../../../../instance.json";
const CLUSTER_INFO_FILE = '../cluster.json';
const RESOURCE_OPT_FILE = "../resource_opinion.json";
const PORT_OPT_FILE = "../port_opinion.json";
const EXEC_INFO_FILE = "../exec_info.json";
const FILE_PATH = '../rep_hash.dat';
const PORT_EVAL_UNL_SHUFFLE_FILE = './port_eval_unl_shuffle.json';
const TOTAL_FILE_SIZE = Math.floor(1.5 * 1024 * 1024 * 1024);
const WRITE_INTERVAL = 1 * 512 * 1024;
const CHUNK_SIZE = 1024 * 1024;
const PORT_EVAL_LEDGER_INTERVAL = 5;
const PORT_EVAL_UNIVERSE_SIZE = 4;
const PORT_EVAL_TIMEOUT = 15000;
const PORT_EVAL_COUNT = 4;
const SCORE_AVG_BASE = 100;
const RESOURCE_SCORE_WEIGHT = 0.75;

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
                hash.update(chunk);
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

const preparePortEvalMessage = (instanceInfo, ctx) => {
    return ctx.lclHash;
}

const evaluatePortEvalMessage = (instanceInfo, ctx, message) => {
    const evalMessage = getShaHash(`${ctx.lclHash}${instanceInfo.pubkey}`);
    return message == evalMessage ? 1 : 0;
}

const evaluateInstancePorts = async (instanceInfo, ctx) => {
    const evalMessage = preparePortEvalMessage(instanceInfo, ctx);

    const tcpPortList = instanceInfo?.gp_tcp_port ? [parseInt(instanceInfo.gp_tcp_port), parseInt(instanceInfo.gp_tcp_port) + 1] : [];
    const udpPortList = instanceInfo?.gp_udp_port ? [parseInt(instanceInfo.gp_udp_port), parseInt(instanceInfo.gp_udp_port) + 1] : [];

    if (!tcpPortList.length && !udpPortList.length)
        return 0;

    const domain = instanceInfo.domain;

    let score = 0;

    console.log(`Evaluating ports on instance: ${instanceInfo.pubkey}`);

    await Promise.all([
        Promise.all(tcpPortList.map(async (port) => {
            await new Promise((resolve, reject) => {

                const url = `wss://${domain}:${port}`;

                function logInf(...args) {
                    console.log(`[GPTCPClient] ${url} -`, ...args);
                }

                function logErr(...args) {
                    console.error(`[GPTCPClient] ${url} -`, ...args);
                }

                logInf('Evaluating GP port');

                const connection = new WebSocket(url, {
                    rejectUnauthorized: false
                });

                const terminate = () => {
                    if (!connection.OPEN)
                        return;
                    connection.close();
                }

                let completed = false;
                function handleResolve(...args) {
                    if (!completed) {
                        terminate();
                        if ((args?.length ?? 0) > 0)
                            logInf(...args);
                        resolve(args?.length ? args[0] : null);
                        completed = true;
                    }
                }

                function handleReject(...args) {
                    if (!completed) {
                        terminate();
                        if ((args?.length ?? 0) > 0)
                            logErr(...args);
                        reject(args?.length ? args[0] : null);
                        completed = true;
                    }
                }

                connection.onopen = () => {
                    logInf('Connected to the WebSocket server');

                    // Send a evaluation message to the peer instance
                    logInf('Sending:', evalMessage);
                    connection.send(evalMessage);
                };

                connection.onmessage = (event) => {
                    const message = event.data.toString();
                    logInf('Received:', message);
                    // Evaluate the received message and increment score.
                    score += evaluatePortEvalMessage(instanceInfo, ctx, message);
                    handleResolve();
                };

                connection.onerror = (error) => {
                    handleReject('WebSocket error:', error);
                };

                connection.onclose = () => {
                    handleReject('Disconnected from the WebSocket server');
                };

                setTimeout(() => {
                    handleReject(`Max timeout ${PORT_EVAL_TIMEOUT} reached`);
                }, PORT_EVAL_TIMEOUT);
            }).catch(console.error);
        })),
        Promise.all(udpPortList.map(async (port) => {
            await new Promise((resolve, reject) => {

                const url = `wss://${domain}:${port}`;

                function logInf(...args) {
                    console.log(`[GPUDPClient] ${url} -`, ...args);
                }

                function logErr(...args) {
                    console.error(`[GPUDPClient] ${url} -`, ...args);
                }

                logInf('Evaluating GP port');

                const connection = dgram.createSocket('udp4');

                const terminate = () => {
                    if (!connection.OPEN)
                        return;
                    connection.close();
                }

                let completed = false;
                function handleResolve(...args) {
                    if (!completed) {
                        terminate();
                        if ((args?.length ?? 0) > 0)
                            logInf(...args);
                        resolve(args?.length ? args[0] : null);
                        completed = true;
                    }
                }

                function handleReject(...args) {
                    if (!completed) {
                        terminate();
                        if ((args?.length ?? 0) > 0)
                            logErr(...args);
                        reject(args?.length ? args[0] : null);
                        completed = true;
                    }
                }
                // Send a evaluation message to the peer instance
                logInf('Sending:', evalMessage);
                connection.send(evalMessage, port, domain, (error) => {
                    if (error)
                        handleReject('Send error:', error);
                });

                connection.on('message', (message, rinfo) => {
                    const msg = message.toString();
                    logInf('Received:', msg);
                    // Evaluate the received message and increment score.
                    score += evaluatePortEvalMessage(instanceInfo, ctx, msg);
                    handleResolve();
                });

                connection.on('error', (error) => {
                    handleReject('WebSocket error:', error);
                });

                connection.on('close', () => {
                    handleReject('Disconnected from the WebSocket server');
                });

                setTimeout(() => {
                    handleReject(`Max timeout ${PORT_EVAL_TIMEOUT} reached`);
                }, PORT_EVAL_TIMEOUT);
            }).catch(console.error);
        }))
    ]);

    return score;
}

const seededRandom = (seed) => {
    var x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

const shuffle = (array, seed) => {
    return array
        .map(value => ({ value, sort: seededRandom(seed++) }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ value }) => value);
}

const evaluateResources = async (ctx) => {
    const startTime = Date.now();

    let instanceInfo = null;
    if (fs.existsSync(INSTANCE_INFO_FILE))
        instanceInfo = JSON.parse(fs.readFileSync(INSTANCE_INFO_FILE));

    let clusterInfo = {};
    if (fs.existsSync(CLUSTER_INFO_FILE))
        clusterInfo = JSON.parse(fs.readFileSync(CLUSTER_INFO_FILE));

    let res_ops = {};
    if (fs.existsSync(RESOURCE_OPT_FILE))
        res_ops = JSON.parse(Buffer.from(fs.readFileSync(RESOURCE_OPT_FILE)));

    await sodium.ready;

    let [fileHash, pubKeyCodedHash] = [null, null];

    let storedMessages = [];

    ctx.unl.onMessage(async (node, data) => {
        const msg = JSON.parse(data);
        if (storedMessages.findIndex(o => o.node.publicKey === node.publicKey) === -1)
            storedMessages.push({ node, msg });
    });

    [fileHash, pubKeyCodedHash] = await pow(ctx.lclHash, ctx.publicKey);

    await ctx.unl.send(JSON.stringify({ pow: pubKeyCodedHash, instance: instanceInfo }));

    const endTime = Date.now();

    await new Promise((resolve) => {
        setTimeout(() => {
            try {
                console.log("Checking received POWs..");
                for (const { node, msg } of storedMessages) {
                    const pubKeyCodedHash = getPubKeyCodedHash(node.publicKey, fileHash);

                    if (pubKeyCodedHash == msg.pow) {
                        if (!res_ops[node.publicKey])
                            res_ops[node.publicKey] = 1;
                        else
                            res_ops[node.publicKey]++;
                    }

                    if (msg.instance)
                        clusterInfo[node.publicKey] = msg.instance;
                }

                console.log(`Updating cluster file with ${Object.keys(clusterInfo).length} instance details..`);
                fs.writeFileSync(CLUSTER_INFO_FILE, JSON.stringify(clusterInfo, null, 2));
                console.log("Cluster file updated successfully.");

                console.log("Updating resource opinion file:");
                console.log(JSON.stringify(res_ops, null, 2));

                fs.writeFileSync(RESOURCE_OPT_FILE, JSON.stringify(res_ops, null, 2));
                console.log("Resource opinion file updated successfully.");

                return resolve();
            } catch (e) {
                console.error(e);
                resolve();
            }
        }, (OPINION_WRITE_WAIT - (endTime - startTime)));
    });
}

const getPortEvalSubUniverse = (ctx) => {
    if (fs.existsSync(PORT_EVAL_UNL_SHUFFLE_FILE)) {
        const shuffled = JSON.parse(fs.readFileSync(PORT_EVAL_UNL_SHUFFLE_FILE));
        const index = shuffled.findIndex(p => p === ctx.publicKey);
        const subUniverseIndex = Math.floor(index / PORT_EVAL_UNIVERSE_SIZE);
        const subUniverse = shuffled.slice((subUniverseIndex * PORT_EVAL_UNIVERSE_SIZE), ((subUniverseIndex + 1) * PORT_EVAL_UNIVERSE_SIZE));
        return subUniverse;
    }
    return null;
}

const evaluatePorts = async (ctx) => {
    if (ctx.lclSeqNo < (PORT_EVAL_LEDGER_INTERVAL - 1))
        return;

    let clusterInfo = null;
    if (fs.existsSync(CLUSTER_INFO_FILE))
        clusterInfo = JSON.parse(fs.readFileSync(CLUSTER_INFO_FILE));

    const subUniverse = getPortEvalSubUniverse(ctx);
    if (subUniverse && clusterInfo && Object.keys(clusterInfo).length) {
        let port_ops = {};
        if (fs.existsSync(PORT_OPT_FILE))
            port_ops = JSON.parse(Buffer.from(fs.readFileSync(PORT_OPT_FILE)));

        // TODO: Forcefully terminate if ws connection hangs.
        await Promise.all(subUniverse.filter(k => clusterInfo[k]).map(async k => {
            const score = await evaluateInstancePorts(clusterInfo[k], ctx).catch(console.error) ?? 0;
            if (!port_ops[k])
                port_ops[k] = { numerator: score, denominator: PORT_EVAL_COUNT };
            else {
                port_ops[k].numerator += score;
                port_ops[k].denominator += PORT_EVAL_COUNT;
            }
        }));

        console.log("Updating port opinion file:");
        console.log(JSON.stringify(port_ops, null, 2));

        fs.writeFileSync(PORT_OPT_FILE, JSON.stringify(port_ops, null, 2));
        console.log("Port opinion file updated successfully.");
    }

    if (((ctx.lclSeqNo + 1) % PORT_EVAL_LEDGER_INTERVAL) === 0) {
        const unl = ctx.unl.list().map(n => n.publicKey);
        const shuffled = shuffle(unl, ctx.lclSeqNo);
        fs.writeFileSync(PORT_EVAL_UNL_SHUFFLE_FILE, JSON.stringify(shuffled, null, 2));
    }
}

const writeExecInfo = (info) => {
    fs.writeFileSync(EXEC_INFO_FILE, JSON.stringify(info, null, 2));
}

const readExecInfo = () => {
    let info = { count: 0 };
    if (fs.existsSync(EXEC_INFO_FILE))
        info = JSON.parse(fs.readFileSync(EXEC_INFO_FILE));
    return info;
}

const myContract = async (ctx) => {
    if (ctx.readonly) {
        const execInfo = readExecInfo();

        for (const user of ctx.users.list()) {
            // Loop through inputs sent by each user.
            for (const input of user.inputs) {
                const buffer = await ctx.users.read(input);

                const message = buffer.toString();
                const req = JSON.parse(message);

                if (req.command === 'read_scores') {
                    let resourceOutput = fs.existsSync(RESOURCE_OPT_FILE) ? JSON.parse(fs.readFileSync(RESOURCE_OPT_FILE).toString()) : null;
                    let portOutput = fs.existsSync(PORT_OPT_FILE) ? JSON.parse(fs.readFileSync(PORT_OPT_FILE).toString()) : null;
                    let output = {};

                    if (resourceOutput != null) {
                        for (const [key, value] of Object.entries(resourceOutput)) {
                            output[key] = { resource: execInfo?.count ? (value / execInfo.count) : -1, port: -1 };
                        }
                    }
                    if (portOutput != null) {
                        for (const [key, value] of Object.entries(portOutput)) {
                            const score = value?.denominator ? (value.numerator / value.denominator) : -1;
                            if (!output[key])
                                output[key] = { resource: -1, port: score };
                            else
                                output[key].port = score;
                        }
                    }
                    for (const [key, value] of Object.entries(output)) {
                        if (value.resource !== -1 && value.port !== -1)
                            output[key] = Math.round(((value.resource * RESOURCE_SCORE_WEIGHT) + (value.port * (1 - RESOURCE_SCORE_WEIGHT))) * SCORE_AVG_BASE);
                        else if (value.resource !== -1)
                            output[key] = Math.round(value.resource * SCORE_AVG_BASE);
                        else if (value.port !== -1)
                            output[key] = Math.round((value.port * (1 - RESOURCE_SCORE_WEIGHT)) * SCORE_AVG_BASE);
                    }

                    if (!Object.keys(output).length) {
                        console.error(`No scores recorded.`);
                        user.send({ message: null });
                    }
                    else {
                        user.send({ message: { scores: output, execCount: (execInfo?.count ?? 0) } });
                    }
                }
                else if (req.command === 'read_logs') {
                    const hpLog = fs.existsSync(HP_LOG_FILE) ? fs.readFileSync(HP_LOG_FILE).toString() : null;
                    const contractOutLog = fs.existsSync(CONTRACT_OUT_FILE) ? fs.readFileSync(CONTRACT_OUT_FILE).toString() : null;
                    const contractErrLog = fs.existsSync(CONTRACT_ERR_FILE) ? fs.readFileSync(CONTRACT_ERR_FILE).toString() : null;
                    user.send({
                        message: {
                            hp: hpLog,
                            contract: {
                                out: contractOutLog,
                                err: contractErrLog
                            }
                        }
                    });
                }
            }
        }
    }
    else {
        let execInfo = readExecInfo();
        execInfo.count++;

        await Promise.all([evaluateResources(ctx).catch(console.error), evaluatePorts(ctx).catch(console.error)]);

        // Update exec info.
        writeExecInfo(execInfo);
    }

    console.log('Terminating the contract');
    process.kill(process.pid, 'SIGKILL');
};

const hpc = new HotPocket.Contract();
hpc.init(myContract, null, false);
