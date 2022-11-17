let loadingInterval: any;
let lastURLs: { url: string; active: boolean }[] = [];
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
  let url = document.querySelector("input").value;
  if (initialURL?.length) {
    url = initialURL;
  }
  // Checks if vaild url
  if (
    !url.length ||
    (!url.toLowerCase().includes("medal") &&
      !url.toLowerCase().includes("clips"))
  )
    return alert("Please input a vaild medal clip!");
  if (!url.toLowerCase().includes("?theater=true")) url += "?theater=true";
  if (!url.toLowerCase().startsWith("https://")) url = "https://" + url;
  // Check if downloading or is already downlowaed
  if (
    lastURLs.some(
      (u) =>
        url
          .toLowerCase()
          .split("/clips/")[1]
          .split("/")[0]
          .replace("?theater=true", "") ===
        u.url
          .toLowerCase()
          .split("/clips/")[1]
          .split("/")[0]
          .replace("?theater=true", "")
    )
  )
    return alert("Medal clip already downloading/downloaded!");
  if (cooldown > 0) return alert("Please wait " + cooldown + " seconds.");
  cooldown = 6;
  button.disabled = true;
  button.style.cursor = "not-allowed";
  button.innerText = "Wait " + cooldown + " seconds!";
  lastURLs.push({ url, active: true }); // History of clips
  const containerElement = document.createElement("div");
  const videoElement = document.createElement("video");
  const aElement = document.createElement("a");
  containerElement.classList.add("video");
  aElement.target = "_blank";
  aElement.download = "MedalDownload";
  aElement.innerText = "Download Here";
  const data = { url };
  startLoading();
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
    const video: { valid: boolean; src: string } | undefined =
      await fetchData?.json(); // Returns download link
    lastURLs[lastURLs.findIndex((u) => u.url === url)].active = false; // Edits history to link toggle link to done
    stopLoading();
    // Checks if vaild
    if (!video?.valid) {
      // Remove url from history
      lastURLs.splice(
        lastURLs.findIndex((u) => u.url === url),
        1
      );
      return alert(
        "Please input a vaild Medal clip! (Make sure it's not private, etc..)\nOR Please give it a couple of seconds and retry!"
      );
    }
    // Adds download btn and video to screen
    aElement.href = video.src;
    videoElement.src = video.src;
    videoElement.controls = true;
    containerElement.prepend(videoElement);
    containerElement.prepend(aElement);
    videosContainer.prepend(containerElement);
  } catch {
    // FOR ERRORS!
    lastURLs.splice(
      lastURLs.findIndex((u) => u.url === url),
      1
    );
    stopLoading();
    return alert(
      "Please input a vaild Medal clip! (Make sure it's not private, etc..)\nOR Please give it a couple of seconds and retry!"
    );
  }
}
function startLoading() {
  if (loadingInterval) clearInterval(loadingInterval);
  loading.style.display = "block";
  let numOfDots = 1;
  loadingInterval = setInterval(() => {
    numOfDots += 1;
    if (numOfDots >= 4) numOfDots = 1;
    loading.innerText = "Loading" + ".".repeat(numOfDots);
  }, 500);
}
function stopLoading() {
  if (lastURLs.some((u) => u.active)) return;
  if (loadingInterval) clearInterval(loadingInterval);
  loading.style.display = "none";
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
