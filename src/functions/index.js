require("dotenv").config();
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const os = require("os");
const chromium = require("chrome-aws-lambda");
const fs = require("fs/promises");
const m3u8ToMp4 = require("m3u8-to-mp4");
const converter = new m3u8ToMp4();
const puppeteer = require("puppeteer-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
puppeteer.use(stealth);

const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const bucket = admin.app().storage().bucket("medalbypass.appspot.com");

async function startFileGet(url) {
  try {
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
    });
    const page = await browser.newPage();
    const client = await page.target().createCDPSession();
    return await getFileURL(url, page, browser, client);
  } catch (e) {
    return null;
  }
}

function getFileURL(url, page, browser, client) {
  const logInAtagSelector =
    "#__next > div > div.deviceSize__Desktop-sc-1wgp2re-0.clmXhW > nav > div.StyledBox-sc-13pk1d4-0.ZIwwl > div.StyledBox-sc-13pk1d4-0.lfUOxE > a:nth-child(5)";
  let privateFound = false;
  let fileFound = false;
  let cdnURLFound = false;
  let cdnURL = "";
  let interval;
  return new Promise(async (resolve, reject) => {
    try {
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
        async ({ interceptionId, request }) => {
          if (request.url.includes("master.m3u8") && !fileFound) {
            functions.logger.log(request.url);
            fileFound = true;
            const urlId = url
              .split("/clips/")[1]
              .split("/")[0]
              .replace("?theater=true", "");
            const id = urlId?.length
              ? urlId
              : `${Math.random() * 999999}`.replace(".", "_");
            const bucketFileName = "Medal_Clip_" + id + ".mp4";
            const fileName = "/temp" + bucketFileName;
            const fileDirName = os.tmpdir() + fileName;
            try {
              const bucketFile = bucket.file(bucketFileName);
              if (bucketFile?.name) {
                if (!(await bucketFile.isPublic()))
                  await bucketFile.makePublic();
                const [metadata] = await bucketFile.getMetadata();
                const publicSrcUrl = metadata.mediaLink;
                if (publicSrcUrl) return resolve(publicSrcUrl);
              }
            } catch {}
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
                const publicSrcUrl = clipMetaData.mediaLink;
                await browser.close();
                await fs.unlink(fileDirName);

                resolve(publicSrcUrl);
              })
              .catch(reject);
          }

          if (interceptionId) {
            try {
              await client.send("Network.continueInterceptedRequest", {
                interceptionId,
              });
            } catch {}
          }
        }
      );
      client.on("error", () => {});
      setTimeout(async () => {
        if (!fileFound && !cdnURLFound && !privateFound) {
          await browser.close();
          reject();
        }
      }, 15000);
      try {
        await page.goto(url, { waitUntil: "load" });
        await page.waitForSelector("video");
        await page.waitForSelector(logInAtagSelector);
      } catch {
        reject();
      }
      const initalSrc = await page.evaluate(
        () =>
          document.querySelector("video")?.src ||
          document.querySelector("source")?.src
      );
      if (checkIfMedalClipCDN(initalSrc)) {
        cdnURLFound = true;
        cdnURL = initalSrc;
        clearInterval(interval);
      }
      if (
        initalSrc.toLowerCase().split("?info")[0] ===
        "https://cdn.medal.tv/assets/video/privacy-protected-guest-720p.c4821e1e.mp4"
      ) {
        privateFound = true;
        await page.click(logInAtagSelector);
        const userNameSelector = "#username > div > input";
        const passwordSelector = "input[data-testid='password-field']";
        const frameHandler = await page.waitForSelector("iframe[src='/login']");
        const frame = await frameHandler.contentFrame();
        await frame.waitForSelector(userNameSelector);
        await frame.type(userNameSelector, process.env.USERNAME);
        await frame.waitForSelector(passwordSelector);
        await frame.type(passwordSelector, process.env.PASSWORD);
        await frame.click("button[data-testid='log-in-button']");
        try {
          await page.waitForNavigation({ timeout: 10000 });
          interval = setInterval(async () => {
            const checkSrc = await page.evaluate(
              () =>
                document.querySelector("video")?.src ||
                document.querySelector("source")?.src
            );
            if (checkIfMedalClipCDN(checkSrc)) {
              await browser.close();
              resolve(checkSrc);
              clearInterval(interval);
            }
          }, 1000);
        } catch {
          reject();
        }
      }
      setTimeout(async () => {
        if (!fileFound && cdnURLFound && !privateFound) {
          await browser.close();
          resolve(cdnURL);
        }
      }, 2500);
    } catch (e) {
      reject();
    }
  });
}

exports.video = functions
  .runWith({
    timeoutSeconds: 300,
    memory: "4GB",
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
      const src = await startFileGet(req.body.url);
      if (src) {
        return res.json({ valid: true, src });
      } else throw new Error("No data");
    } catch (e) {
      console.log(e);
      return res.json({ valid: false });
    }
  });

function checkIfMedalClipCDN(str) {
  if (!str) return false;
  if (!str?.toLowerCase().includes("cdn.medal.tv/")) return false;
  if (
    str.toLowerCase().split("?info")[0] ===
    "https://cdn.medal.tv/assets/video/privacy-protected-guest-720p.c4821e1e.mp4"
  )
    return false;
  if (str?.toLowerCase().includes("cdn.medal.tv/source/")) return true;
  else if (
    str?.toLowerCase().includes("720p") ||
    str?.toLowerCase().includes("1080p")
  )
    return true;
}
