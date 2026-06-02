const ANDROID_PREVIEW_BUILD_ID = "adf63bcf-cbae-44b6-9ebe-47c0e9778d45";
const ANDROID_PREVIEW_URL = `https://expo.dev/accounts/arboros/projects/arbor-mobile/builds/${ANDROID_PREVIEW_BUILD_ID}`;

function getAndroidPreviewUrl() {
  return process.env.EAS_ANDROID_PREVIEW_URL || ANDROID_PREVIEW_URL;
}

module.exports = {
  ANDROID_PREVIEW_BUILD_ID,
  ANDROID_PREVIEW_URL,
  getAndroidPreviewUrl,
};
