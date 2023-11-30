// IMPORTS
import dotenv from "dotenv";
dotenv.config();
import functions, { Response } from "firebase-functions";
import { Request } from "firebase-functions/lib/common/providers/https";
import fetch from "cross-fetch";

function getFileURL(url: string): Promise<string | null> {
  return new Promise(async (resolve) => {
    // Fetches the html and finds the contentUrl (from the hydrationData), then returns the url if it exists
    const res = await fetch(url);
    const html = await res.text();
    const fileURL = html.split('"contentUrl":"')[1]?.split('","')[0];
    if (fileURL) return resolve(fileURL);
  });
}

// HTTP endpoint /medalwatermark
const medalwatermark = functions
  .runWith({
    timeoutSeconds: 30,
    memory: "2GB", // Just in case
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

    try {
      const src = await getFileURL(url);
      if (src) res.json({ valid: true, src });
      else res.json({ valid: false });
    } catch {
      res.json({ valid: false });
    }
  });

export { medalwatermark };
