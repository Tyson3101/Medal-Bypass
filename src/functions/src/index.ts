// IMPORTS
import dotenv from "dotenv";
dotenv.config();
import functions, { Response } from "firebase-functions";
import { Request } from "firebase-functions/lib/common/providers/https";
import puppeteer, { Page, Browser } from "puppeteer";
import chromium from "chrome-aws-lambda";

function getFileURL(url: string, browser: Browser): Promise<string | null> {
  return new Promise(async (resolve) => {
    // Set up page
    const page = await browser.newPage();

    // Clip Id
    const id = url.split("/clips/")[1].split("/")[0];
    if (!id) return resolve(null);

    try {
      await page.goto(url, { waitUntil: "load" });
      // Waits for video url meta tag to load (VIDEO URL IS FOR EMBEDS, AKA DISCORD)
      await page.waitForSelector("head > meta[property='og:video:url']", {
        timeout: 10000,
      });
    } catch {
      return resolve(null);
    }

    const fileURL = await evalForVideoURL(page);

    if (!fileURL) return resolve(null);
    if (["media", "source"].some((str) => fileURL.toLowerCase().includes(str)))
      return resolve(fileURL);
    if (fileURL.toLowerCase().includes("privacy-protected")) {
      await logInToMedal(page);
      let recheckFileURL = await evalForVideoURL(page);
      if (
        ["media", "source"].some((str) =>
          recheckFileURL?.toLowerCase().includes(str)
        )
      )
        return resolve(recheckFileURL);
    }
    return resolve(null);
  });
}

// HTTP endpoint /video
const video = functions
  .runWith({
    timeoutSeconds: 150,
    memory: "1GB", // Just in case
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

function evalForVideoURL(page: Page) {
  return page.$eval("head > meta[property='og:video:url']", (el) =>
    el.getAttribute("content")
  );
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
