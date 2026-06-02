const ANDROID_PREVIEW_BUILD_ID = "fbfcac3c-bf86-404a-a5c0-0fd7ce7f134e";
const ANDROID_PREVIEW_URL = `https://expo.dev/accounts/arboros/projects/arbor-mobile/builds/${ANDROID_PREVIEW_BUILD_ID}`;

function getAndroidPreviewUrl() {
  return process.env.EAS_ANDROID_PREVIEW_URL || ANDROID_PREVIEW_URL;
}

module.exports = {
  ANDROID_PREVIEW_BUILD_ID,
  ANDROID_PREVIEW_URL,
  getAndroidPreviewUrl,
};
