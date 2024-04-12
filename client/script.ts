const ERROR_MESSAGE = `Please enter a valid Medal clip URL/ID.
Make sure you have copied the URL/ID correctly and the clip is not private.
OR
Wait a couple of seconds and try again.`;

const LOADING_MESSAGE = `Bypassing Watermark`;

const COOLDOWN_START = 3;

let loadingInterval: number | null = null;
let lastURLs: { id: string; active: boolean }[] = [];
let cooldown = 0;

const videosContainer = document.querySelector("#videos");
const loading = document.querySelector("p");

const linkHelp = document.querySelector(".linkHelp") as HTMLDivElement;
const linkIssues = document.querySelector(".linkIssues") as HTMLDivElement;

const button = document.querySelector("button");
button.addEventListener("click", () => downloadVideo());

const params = new URLSearchParams(document.location.search);
if (params.get("url")?.length) {
  downloadVideo(params.get("url"));
}

async function downloadVideo(initialURL?: string) {
  let checkURL = initialURL ?? document.querySelector("input").value;

  let url = configureURL(checkURL);
  if (!url) return alert("Please enter a valid Medal clip URL/ID.");

  const id = extractClipID(url);
  if (!id) return alert("Please enter a valid Medal clip URL/ID.");

  if (isClipAlreadyDownloaded(id)) {
    return alert("You already downloaded this clip!");
  }

  if (cooldown > 0) {
    return alert("Please wait " + cooldown + " seconds.");
  }

  cooldown = COOLDOWN_START;
  updateButtonState(cooldown);
  addClipToHistory(id);

  startLoading();

  try {
    const video = await fetchVideoWithoutWatermark(url);
    if (!video?.valid) {
      stopLoading(false);
      return alert(ERROR_MESSAGE);
    }
    stopLoading(video?.valid);
    displayVideoWithDownloadLink(video.src, id);
  } catch {
    stopLoading();
    return alert(ERROR_MESSAGE);
  }
}

async function fetchVideoWithoutWatermark(
  url: string
): Promise<{ src: string; valid: boolean } | undefined> {
  const data = { url };
  const fetchData = await fetch(
    "https://us-central1-medalbypass.cloudfunctions.net/medalwatermark",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }
  ).catch((e) => e);
  return fetchData?.json();
}

function configureURL(url: string): string | false {
  if (!url) return false;
  if (!url.toLowerCase().includes("medal")) {
    if (!url.includes("/") && !url.includes(" "))
      url = "https://medal.tv/clips/" + url;
    else return false;
  }
  if (!url.toLowerCase().includes("https://")) {
    url = "https://" + url;
  }
  if (!url.toLowerCase().includes("?mobilebypass=true")) {
    url += "?mobilebypass=true";
  }

  url = url.replace("?theater=true", "");

  return url;
}

function displayVideoWithDownloadLink(src: string, id: string): void {
  const containerElement = document.createElement("div");
  const videoElement = document.createElement("video");
  const aElement = document.createElement("a");
  containerElement.classList.add("video");
  aElement.download = "MedalTV_" + id + ".mp4";
  aElement.innerText = "Download Here";
  aElement.href = src;
  videoElement.src = src;
  videoElement.controls = true;
  containerElement.prepend(videoElement);
  containerElement.prepend(aElement);
  videosContainer.prepend(containerElement);
  document.body.dataset["clipsShown"] = "true";
}

function extractClipID(url: string): string {
  if (url.includes("/clips/")) return url.split("/clips/")[1].split("/")[0];
  if (!url.includes(" ")) return url;
  else return "false";
}

function isClipAlreadyDownloaded(id: string): boolean {
  return lastURLs.some((u) => id === u.id);
}

function removeClipFromHistory(id: string): void {
  const index = lastURLs.findIndex((u) => u.id === id);
  if (index !== -1) {
    lastURLs.splice(index, 1);
  }
}

function updateClipFromHistory(id: string): void {
  const index = lastURLs.findIndex((u) => u.id === id);
  if (index !== -1) {
    lastURLs[index].active = false;
  }
}

function updateButtonState(cooldown: number): void {
  button.disabled = true;
  button.style.cursor = "not-allowed";
  button.innerText = "Wait " + cooldown + " seconds!";
}

function addClipToHistory(id: string): void {
  lastURLs.push({ id, active: true });
}

function startLoading() {
  if (loadingInterval) clearInterval(loadingInterval);
  loading.style.display = "block";
  linkHelp.style.display = "none";
  linkIssues.style.display = "none";
  loading.innerText = LOADING_MESSAGE;
  let numOfDots = 0;
  loadingInterval = setInterval(() => {
    numOfDots += 1;
    if (numOfDots >= 4) numOfDots = 0;
    loading.innerText = LOADING_MESSAGE + ".".repeat(numOfDots);
  }, 500);
}

function stopLoading(successful = true, id = "") {
  if (id) {
    if (successful) updateClipFromHistory(id);
    else removeClipFromHistory(id);
  }
  if (lastURLs.some((u) => u.active)) return;
  if (loadingInterval) clearInterval(loadingInterval);
  loading.style.display = "none";
  if (!successful) {
    linkHelp.style.display = "block";
    linkIssues.style.display = "block";
  }
}

// Cooldown
setInterval(() => {
  if (cooldown > 0) {
    button.disabled = true;
    button.style.cursor = "not-allowed";
    button.innerText = "Wait " + cooldown + " seconds!";
    cooldown--;
  } else {
    button.disabled = false;
    button.style.cursor = "pointer";
    if (button.innerText !== "Download")
      button.innerText = "Download Another Clip";
  }
}, 1000);
