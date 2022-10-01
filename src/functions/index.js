const functions = require("firebase-functions");
const admin = require("firebase-admin");
const os = require("os");
const chromium = require("chrome-aws-lambda");
const fs = require("fs/promises");
const m3u8ToMp4 = require("m3u8-to-mp4");
const converter = new m3u8ToMp4();
const puppeteer = require("puppeteer-extra");
let stealth = require("puppeteer-extra-plugin-stealth")();
puppeteer.use(stealth);

const serviceAccount = require("./serviceAccountKey.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const bucket = admin.app().storage().bucket("medalbypass.appspot.com");

function getFileURL(url) {
  let fileFound = false;
  let cdnURLFound = false;
  return new Promise(async (resolve, r) => {
    try {
      const browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath,
        headless: chromium.headless,
      });
      const page = await browser.newPage();
      const client = await page.target().createCDPSession();

      await client.send("Network.enable");
      await client.send("Network.setRequestInterception", {
        patterns: [
          {
            urlPattern: "*",
          },
        ],
      });

      client.on(
        "Network.requestIntercepted",
        async ({ interceptionId, request, responseHeaders, resourceType }) => {
          if (request.url.includes("master.m3u8") && !fileFound) {
            functions.logger.log(request.url);
            fileFound = true;
            const randomNumber = `${Math.random() * 999999}`.replace(".", "_");
            const bucketFileName = "Medal_Clip_" + randomNumber + ".mp4";
            const fileName = "/temp" + bucketFileName;
            const fileDirName = os.tmpdir() + fileName;
            converter
              .setInputFile(request.url)
              .setOutputFile(fileDirName)
              .start()
              .then(async () => {
                const uploadClipResponse = await bucket.upload(fileDirName, {
                  destination: bucketFileName,
                });

                await uploadClipResponse[0].makePublic();
                const [clipMetaData] =
                  await uploadClipResponse[0].getMetadata();
                const url = clipMetaData.mediaLink;
                await browser.close();
                await fs.unlink(fileDirName);
                setTimeout(() => {
                  bucket
                    .file(bucketFileName)
                    .delete()
                    .catch((e) => e);
                }, 60000 * 15);
                resolve(url);
              });
          }
          if (interceptionId)
            client.send("Network.continueInterceptedRequest", {
              interceptionId,
            });
        }
      );
      client.on("error", () => {});
      setTimeout(async () => {
        if (!fileFound && !cdnURLFound) {
          await browser.close();
          r();
        }
      }, 16000);
      try {
        await page.goto(url);
        await page.waitForSelector("video");
      } catch {
        r();
      }
      const src = await page.evaluate(
        () =>
          document.querySelector("video")?.src ||
          document.querySelector("source")?.src
      );
      if (src?.includes("cdn.medal.tv/")) cdnURLFound = true;
      setTimeout(async () => {
        if (!fileFound && cdnURLFound) {
          await browser.close();
          console.log({ src });
          resolve(src);
        }
      }, 7000);
    } catch {
      r();
    }
  });
}

exports.video = functions
  .runWith({
    timeoutSeconds: 300,
    memory: "1GB",
  })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Max-Age", "3600");
    let url = req.body.url;
    if (req.method.toLowerCase() === "GET") {
      url = req.query.url;
    }
    if (!url?.length || !url.toLowerCase().includes("medal"))
      return res.json({ valid: false });
    if (!url.toLowerCase().includes("?theater=true")) url += "?theater=true";
    try {
      const src = await getFileURL(req.body.url);
      if (src) return res.json({ valid: true, src });
      else throw new Error("No data");
    } catch (e) {
      console.log(e);
      return res.json({ valid: false });
    }
  });
