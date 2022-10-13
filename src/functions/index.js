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

// Initialize Firebase Bucket
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const bucket = admin.app().storage().bucket("medalbypass.appspot.com");

async function startFileGet(url) {
  try {
    // Create Browser and Page
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
      // Listens for netowrk requests
      client.on(
        "Network.requestIntercepted",
        async ({ interceptionId, request }) => {
          // Checks if master.m3u8 (The file of medal clip)
          if (request.url.toLowerCase().includes("master.m3u8") && !fileFound) {
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
              // Checks if already converted
              const bucketFile = bucket.file(bucketFileName);
              if (bucketFile?.name) {
                if (!(await bucketFile.isPublic()))
                  await bucketFile.makePublic();
                const [metadata] = await bucketFile.getMetadata();
                const publicSrcUrl = metadata.mediaLink;
                if (publicSrcUrl) {
                  await browser.close();
                  // Sends download link
                  return resolve(publicSrcUrl);
                }
              }
            } catch {}
            // Converts m3u8 file to mp4
            converter
              .setInputFile(request.url)
              .setOutputFile(fileDirName)
              .start()
              .then(async () => {
                // Uploads file to firebase storage, because of 10mb response limit
                const uploadClipResponse = await bucket.upload(fileDirName, {
                  destination: bucketFileName,
                });

                await uploadClipResponse[0].makePublic();
                const [clipMetaData] =
                  await uploadClipResponse[0].getMetadata();
                const publicSrcUrl = clipMetaData.mediaLink;
                await browser.close();
                await fs.unlink(fileDirName);
                // Sends download link
                resolve(publicSrcUrl);
              })
              .catch(async () => {
                await browser.close();
                reject();
              });
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
        // If nothing found within 15 secs, stop.
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
        await browser.close();
        reject();
      }
      // For older clips that already have the mp4 embedded or to see if need to login to see
      const initalSrc = await page.evaluate(
        () =>
          document.querySelector("video")?.src ||
          document.querySelector("source")?.src
      );
      // Check if it is the medal source url
      if (checkIfMedalClipCDN(initalSrc)) {
        cdnURLFound = true;
        cdnURL = initalSrc;
        clearInterval(interval);
      }
      // Private (need to log in to see)
      if (
        initalSrc.toLowerCase().split("?info")[0] ===
        "https://cdn.medal.tv/assets/video/privacy-protected-guest-720p.c4821e1e.mp4"
      ) {
        privateFound = true;
        // Logs in
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
          // Finds the source url
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
          await browser.close();
          reject();
        }
      }
    } catch (e) {
      // If errors (#rip)
      await browser.close();
      reject();
    }
  });
}

exports.video = functions
  .runWith({
    timeoutSeconds: 300,
    memory: "4GB", // For big clips
  })
  .https.onRequest(async (req, res) => {
    // Cors
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Max-Age", "3600");
    let url = req.body.url;
    if (req.method === "GET") {
      url = req.query.url;
    }
    // Checks if vaild url
    if (
      !url?.length ||
      !url.toLowerCase().includes("medal") ||
      !url.toLowerCase().includes("clips")
    )
      return res.json({ valid: false });
    if (!url.toLowerCase().includes("?theater=true")) url += "?theater=true";
    if (!url.toLowerCase().startsWith("https://")) url = "https://" + url;
    try {
      const src = await startFileGet(req.body.url);
      if (src) {
        return res.json({ valid: true, src });
      } else res.json({ valid: false });
    } catch (e) {
      return res.json({ valid: false });
    }
  });

// Checks if medal clip
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
