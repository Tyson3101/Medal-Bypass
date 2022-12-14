const ERROR_MESSAGE = `Please enter a valid Medal clip URL/ID.
Make sure you have copied the URL/ID correctly and the clip is not private.
OR
Wait a couple of seconds and try again.`;

const LOADING_MESSAGE = `Bypassing Watermark`;

let loadingInterval: number | undefined;
let lastURLs: { active: boolean; id: string }[] = [];
let cooldown = 0;
const videosContainer = document.querySelector("#videos");
const loading = document.querySelector("p");
const button = document.querySelector("button");
button.addEventListener("click", () => downloadVideo());
const params = new URLSearchParams(document.location.search);
if (params.get("url")?.length) {
  downloadVideo(params.get("url"));
}
async function downloadVideo(initialURL?: string) {
  let url: string = document.querySelector("input").value;
  // Checks URL Parmam if no URL is entered
  if (initialURL?.length && !url.length) {
    url = initialURL;
  }

  // Checks if vaild url
  if (!url) return alert("Please enter a valid Medal clip URL/ID.");
  if (!url.includes("medal")) {
    if (!url.includes("/")) url = "https://medal.tv/clips/" + url;
    else return alert("Please enter a valid Medal clip URL/ID.");
  }

  url = url.replace("?theater=true", "");

  // Clip ID
  const id = url.split("/clips/")[1].split("/")[0];

  // Check if downloading or is already downlowaed
  if (lastURLs.some((u) => id === u.id))
    return alert("You already download this clip!");
  if (cooldown > 0) return alert("Please wait " + cooldown + " seconds.");
  cooldown = 6;
  button.disabled = true;
  button.style.cursor = "not-allowed";
  button.innerText = "Wait " + cooldown + " seconds!";
  lastURLs.push({ id, active: true }); // History of clips
  startLoading();
  const containerElement = document.createElement("div");
  const videoElement = document.createElement("video");
  const aElement = document.createElement("a");
  containerElement.classList.add("video");
  aElement.target = "_blank";
  aElement.download = "MedalTV_" + id + ".mp4";
  aElement.innerText = "Download Here";
  const data = { url };
  try {
    // Sends URL to server to download clip without watermark
    const fetchData = await fetch(
      "https://us-central1-medalbypass.cloudfunctions.net/video",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }
    ).catch((e) => e);
    const video = (await fetchData?.json()) as { valid: boolean; src: string }; // Returns download link
    lastURLs[lastURLs.findIndex((u) => u.id === id)].active = false; // Edits history to link toggle link to done
    // Checks if vaild
    stopLoading(!!video?.valid);
    if (!video?.valid) {
      // Remove url from history
      lastURLs.splice(
        lastURLs.findIndex((u) => u.id === id),
        1
      );
      return alert(ERROR_MESSAGE);
    }
    // Adds download btn and video to screen
    aElement.href = video.src;
    videoElement.src = video.src;
    videoElement.controls = true;
    containerElement.prepend(videoElement);
    containerElement.prepend(aElement);
    videosContainer.prepend(containerElement);
    document.body.dataset["clipsShown"] = "true";
  } catch {
    // FOR ERRORS!
    lastURLs.splice(
      lastURLs.findIndex((u) => u.id === id),
      1
    );
    stopLoading();
    return alert(ERROR_MESSAGE);
  }
}
function startLoading() {
  if (loadingInterval) clearInterval(loadingInterval);
  loading.style.display = "block";
  (document.querySelector(".linkHelp") as HTMLAnchorElement).style.display =
    "none";
  (document.querySelector(".linkIssues") as HTMLAnchorElement).style.display =
    "none";
  loading.innerText = LOADING_MESSAGE;
  let numOfDots = 0;
  loadingInterval = setInterval(() => {
    numOfDots += 1;
    if (numOfDots >= 4) numOfDots = 0;
    loading.innerText = LOADING_MESSAGE + ".".repeat(numOfDots);
  }, 500);
}
function stopLoading(successful = true) {
  if (lastURLs.some((u) => u.active)) return;
  if (loadingInterval) clearInterval(loadingInterval);
  loading.style.display = "none";
  if (!successful) {
    (document.querySelector(".linkHelp") as HTMLAnchorElement).style.display =
      "block";
    (document.querySelector(".linkIssues") as HTMLAnchorElement).style.display =
      "block";
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
