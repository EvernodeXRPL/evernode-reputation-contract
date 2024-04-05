const HotPocket = require('hotpocket-nodejs-contract');
const crypto = require('crypto');
const fs = require('fs');
const reqsevens = 5;

const tsfile = "timestamps.txt";

const opfile = "../opinion.txt";

function pow(lgrhex, pubkeyhex, sevens)
{
	for(let upto = 0n; upto < 0xFFFFFFFFFFFFFFFFn ; upto++)
	{

		let uptohex = upto.toString(16);
        if (uptohex.length < 16)
			uptohex = '0'.repeat(16 - uptohex.length) + uptohex;
 
		let buf = Buffer.from(lgrhex + pubkeyhex + uptohex, "hex");

		let sha = crypto.createHash('sha512').update(buf).digest('hex');

		let i = 0;
		for (; i < sevens && i < sha.length; ++i)
		{
			if (sha.charCodeAt(i) == 55)
			{
				if (i >= sevens - 1)
                    return uptohex;

                // next
			}
			else break;
		}
    }

    // this failure case will never happen but cover it anyway
    return '0'.repeat(16);
}

function countsevens(lgrhex, pubkeyhex, uptohex)
{
    let buf = Buffer.from(lgrhex + pubkeyhex + uptohex, "hex");
    let sha = crypto.createHash('sha512').update(buf).digest('hex');

    for (let i = 0; i < sha.length; ++i)
    {
        if (sha.charCodeAt(i) != 55)
            return i;
    }
    return sha.length;
}

const myContract = async (ctx) => {
    if (ctx.readonly)
    {

        return;
    }

    fs.appendFileSync(tsfile, ctx.timestamp + "\n");
    
    let good = {};

    ctx.unl.onMessage((node, msg) =>
    {
        let sev = countsevens(ctx.lclHash, node.publicKey, msg);
        if (sev >= reqsevens)
            good[node.publicKey] = 1;
    });
    
    await ctx.unl.send(pow(ctx.lclHash, ctx.publicKey, reqsevens));


    // wait 3 seconds
    await new Promise((resolve) => 
    {
        setTimeout(() =>
        {
           // write out our opinions
       
            try
            {
                if (!fs.existsSync(opfile))
                {
                    fs.appendFileSync(opfile, JSON.stringify(good)); 
                    return resolve();
                }
        
                let ops = JSON.parse(Buffer.from(fs.readFileSync(opfile), 'utf-8'));
                for (k in good)
                {
                    if (k in ops)
                        ops[k]++;
                    else
                        ops[k] = 1;
                }

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
hpc.init(myContract);