/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import { onRequest } from "firebase-functions/v2/https";
//import * as logger from "firebase-functions/logger";

import { Response } from "express-serve-static-core";
import { Request } from "express-serve-static-core";
import fetch from "cross-fetch";

function getVideoURL(url: string): Promise<string | null> {
  return new Promise(async (resolve) => {
    // Fetches the html and finds the contentUrl (from the hydrationData), then returns the url if it exists

    let html: string;
    try {
      const res = await fetch(url);
      html = await res.text();
    } catch {
      return resolve(null);
    }

    const videoContentURL = html?.split('"contentUrl":"')[1]?.split('","')[0];
    if (videoContentURL) return resolve(videoContentURL);

    // -
    // If the contentUrl can't be found, check the meta video tag (FOR EMBEDS, etc)
    const videoMetaUrl = html
      ?.split('property="og:video:url" content="')[1]
      ?.split('"')[0];

    if (videoMetaUrl) return resolve(videoMetaUrl);

    return resolve(null);
  });
}

/* 
https://us-central1-medalbypass.cloudfunctions.net/medalwatermark?url=<Url of Medal Clip>
https://us-central1-medalbypass.cloudfunctions.net/medalwatermark?id=<ID of Medal Clip>
*/
// HTTP endpoint /medalwatermark
const medalwatermark = onRequest(
  async (req: Request, res: Response): Promise<any> => {
    // Cors
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Max-Age", "3600");

    // Helper function to get input URL
    const getInputUrl = (): string => {
      if (req.method === "GET") {
        return (req.query.url as string) || (req.query.id as string) || "";
      } else {
        return (req.body.url as string) || (req.body.id as string) || "";
      }
    };

    // Get the input URL
    const inputtedUrl: string = getInputUrl();

    const url = configureURL(inputtedUrl);
    if (!url || !checkURL(url))
      return res.json({ valid: false, reasoning: "Invalid URL" });

    try {
      const src = await getVideoURL(url);
      if (src) res.json({ valid: true, src });
      else res.json({ valid: false, reasoning: "No clip found" });
    } catch {
      res.json({ valid: false, reasoning: "Error fetching clip" });
    }
  }
);

function configureURL(url: string): string | false {
  if (!url) return false;
  if (!url.toLowerCase().includes("medal")) {
    if (!url.includes("/")) url = "https://medal.tv/?contentId=" + url.trim();
    else return false;
  }
  if (
    url.toLowerCase().indexOf("https://") !==
    url.toLowerCase().lastIndexOf("https://")
  ) {
    return false;
  }
  if (!url.toLowerCase().includes("https://")) {
    url = "https://" + url;
  }

  url = url.replace("?theater=true", "");
  return url;
}

function checkURL(url: string): boolean {
  try {
    if (!url) return false;
    if (!new URL(url).hostname.toLowerCase().includes("medal")) {
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

export { medalwatermark };
