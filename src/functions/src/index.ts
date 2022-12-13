// IMPORTS
import dotenv from "dotenv";
dotenv.config();
import functions, { Response } from "firebase-functions";
import { Request } from "firebase-functions/lib/common/providers/https";
import admin from "firebase-admin";
import { initializeApp } from "firebase-admin/app";
import { File } from "@google-cloud/storage";
import puppeteer from "puppeteer-extra";
import { Page, Browser } from "puppeteer";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import m3u8ToMp4 from "m3u8-to-mp4";
import os from "os";
import chromium from "chrome-aws-lambda";
import fs from "fs/promises";
import { readFileSync } from "fs";

// Initialize Puppeteer and m3u8ToMp4 Converter
const converter = new m3u8ToMp4();
const stealth = StealthPlugin();
puppeteer.use(stealth);

// Loads Service Account Key
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

function getFileURL(url: string, browser: Browser): Promise<string | null> {
  return new Promise(async (resolve) => {
    // Set up page and request interception
    const page = await browser.newPage();
    await page.setRequestInterception(true);

    // Clip Id
    const id = url.split("/clips/")[1].split("/")[0];
    if (!id) return resolve(null);

    // Listens to network requests
    page.on("request", async (request) => {
      // Checks if clip is invalid
      if (page.url().toLowerCase().includes("medal.tv/error"))
        return resolve(null);
      // Checks if request is m3u8 file (THE MEDAL CLIP FILE)
      if (["master.m3u8", id].every((v) => request.url().includes(v))) {
        // File Name + Location
        const bucketFileName = "MedalTV_" + id + ".mp4";
        const fileName = "/temp" + bucketFileName;
        const fileDirName = os.tmpdir() + fileName;
        try {
          // Checks if already converted
          const bucketFile = bucket.file(bucketFileName);
          const publicSrcUrl = await bucketFileURL(bucketFile);
          if (publicSrcUrl) {
            // Sends download link
            return resolve(publicSrcUrl);
          }
        } catch {}

        // Converts m3u8 file to mp4
        await converter
          .setInputFile(request.url())
          .setOutputFile(fileDirName)
          .start();

        // Uploads mp4 file to bucket
        const uploadClipResponse = await bucket.upload(fileDirName, {
          destination: bucketFileName,
        });
        const publicSrcUrl = await bucketFileURL(uploadClipResponse[0]);

        // Sends download link and deletes temp file
        await fs.unlink(fileDirName);
        return resolve(publicSrcUrl);
      } else if (request.url().includes("cdn.medal.tv/source/")) {
        // Sends source url
        resolve(request.url());
      } else {
        request.continue();
      }
    });
    // Waits for page + elements to load
    try {
      await page.goto(url, { waitUntil: "load" });
      await page.waitForSelector(`[id*='feed-clip-player-${id}'] video`, {
        timeout: 10000,
      });
    } catch {
      return resolve(null);
    }
    // Gets/Checks source url
    const initalSrc = await videoElementSource(page);
    if (initalSrc.includes("cdn.medal.tv/source/")) resolve(initalSrc);
    if (initalSrc.includes("privacy-protected")) {
      // Logs in and trys again to get source url
      await logInToMedal(page);
      const source = await videoElementSource(page);
      if (source.includes("cdn.medal.tv/source/")) resolve(source);
    }
  });
}

// HTTP endpoint /video
const video = functions
  .runWith({
    timeoutSeconds: 150,
    memory: "4GB", // For big clips
  })
  .https.onRequest(async (req: Request, res: Response): Promise<any> => {
    // Cors
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Max-Age", "3600");

    // Gets the input url
    let url: string = req.body.url;
    if (req.method === "GET") {
      url = req.query.url as string;
    }

    // Checks and helps make vaild url
    if (!url) return res.json({ valid: false });
    if (!url.includes("medal")) {
      if (!url.includes("/")) url = "https://medal.tv/clips/" + url;
      else return res.json({ valid: false });
    }

    url = url.replace("?theater=true", "");

    // Starts browser
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
    });
    try {
      const src = await getFileURL(url, browser);
      if (src) res.json({ valid: true, src });
      else res.json({ valid: false });
    } catch {
      res.json({ valid: false });
    }
    // Hacky fix
    return setTimeout(() => browser.close(), 5000);
  });

export { video };

// FUNCTIONS

// Gets the Bucket File URL
async function bucketFileURL(bucketFile: File): Promise<string> {
  if (!bucketFile) return;
  await bucketFile.makePublic();
  const [metadata] = await bucketFile.getMetadata();
  const publicSrcUrl = metadata.mediaLink;
  return publicSrcUrl;
}

// Finds the source url of the video element
function videoElementSource(page: Page): Promise<string> {
  return new Promise(async (resolve) => {
    let interval = setInterval(async () => {
      const checkSrc = await page.evaluate(() => {
        const id = window?.location.href.split("/clips/")[1].split("/")[0];
        return (
          document
            .querySelector(`[id*='feed-clip-player-${id}']`)
            .querySelector("video")?.src ||
          document
            .querySelector(`[id*='feed-clip-player-${id}']`)
            .querySelector("source")?.src
        );
      });
      if (checkSrc) {
        clearInterval(interval);
        resolve(checkSrc);
      }
    }, 1000);
  });
}

async function logInToMedal(page: Page) {
  try {
    // Clicks login button to show login form
    await page.evaluate(() => {
      ([...document.querySelectorAll("nav a")] as HTMLAnchorElement[])
        .find((ele) => ele.innerText?.toLowerCase().includes("log"))
        .click();
    });
    // Enters username and password
    const userNameSelector = "#username > div > input";
    const passwordSelector = "input[data-testid='password-field']";
    await page.waitForSelector(userNameSelector);
    await page.type(userNameSelector, process.env.USERNAME);
    await page.waitForSelector(passwordSelector);
    await page.type(passwordSelector, process.env.PASSWORD);
    await page.click("button[data-testid='log-in-button']");
    await page.waitForNavigation({ timeout: 10000 });
  } catch {}
}
