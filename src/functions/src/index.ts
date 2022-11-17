import dotenv from "dotenv";
dotenv.config();
import functions, { Response } from "firebase-functions";
import admin from "firebase-admin";
import { initializeApp } from "firebase-admin/app";
import os from "os";
import chromium from "chrome-aws-lambda";
import fs from "fs/promises";
import { readFileSync } from "fs";
import m3u8ToMp4 from "m3u8-to-mp4";
const converter = new m3u8ToMp4();
import puppeteer from "puppeteer-extra";
import { Page, Browser, CDPSession } from "puppeteer";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { Request } from "firebase-functions/lib/common/providers/https";
const stealth = StealthPlugin();
puppeteer.use(stealth);

const loadJSON = (path: string) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url)).toString());

const serviceAccount = loadJSON("./serviceAccountKey.json");

// Initialize Firebase Bucket
initializeApp({
  credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
});
const bucket = admin.app().storage().bucket("medalbypass.appspot.com");
// Auto Delete Files after 1 day (minimum)
bucket
  .addLifecycleRule({
    action: "delete",
    condition: { age: 1 },
  })
  .catch(console.error);

async function startFileGet(url: string) {
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

function getFileURL(
  url: string,
  page: Page,
  browser: Browser,
  client: CDPSession
) {
  const logInAtagSelector =
    "#__next > div > div.deviceSize__Desktop-sc-1wgp2re-0.clmXhW > nav > div.StyledBox-sc-13pk1d4-0.ZIwwl > div.StyledBox-sc-13pk1d4-0.lfUOxE > a:nth-child(5)";
  let privateFound = false;
  let fileFound = false;
  let cdnURLFound = false;
  let cdnURL = "";
  let interval: any;
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
        setTimeout(async () => {
          // If no clip found within 30 secs, stop.
          if (!fileFound && !cdnURLFound) {
            await browser.close();
            reject();
          }
        }, 15000);
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
      // Waits for video element to be found
      try {
        await page.waitForSelector("[id*='feed-clip-player'] video", {
          timeout: 15000,
        });
      } catch {
        // If no video found: Goodbye
        await browser.close();
        reject();
      }
      const initalSrc = await page.evaluate(
        () =>
          document
            .querySelector("[id*='feed-clip-player']")
            .querySelector("video")?.src ||
          document
            .querySelector("[id*='feed-clip-player']")
            .querySelector("source")?.src
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
                document
                  .querySelector("[id*='feed-clip-player']")
                  .querySelector("video")?.src ||
                document
                  .querySelector("[id*='feed-clip-player']")
                  .querySelector("source")?.src
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
      // Incase found false link
      setTimeout(async () => {
        if (!fileFound && cdnURLFound && !privateFound) {
          await browser.close();
          resolve(cdnURL);
        }
      }, 2500);
    } catch (e) {
      // If errors (#rip)
      await browser.close();
      reject();
    }
  });
}

// HTTP endpoint /video
const video = functions
  .runWith({
    timeoutSeconds: 300,
    memory: "4GB", // For big clips
  })
  .https.onRequest(async (req: Request, res: Response): Promise<any> => {
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

export { video };

// Checks if medal clip
function checkIfMedalClipCDN(str: string): boolean {
  if (!str) return false;
  if (!str?.toLowerCase().includes("cdn.medal.tv/")) return false;
  if (str.toLowerCase().includes("privacy-protected-guest")) return false;
  if (str?.toLowerCase().includes("cdn.medal.tv/source/")) return true;
  else if (
    str?.toLowerCase().includes("720p") ||
    str?.toLowerCase().includes("1080p")
  )
    return true;
}
