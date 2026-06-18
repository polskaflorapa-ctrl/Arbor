const ANDROID_PREVIEW_BUILD_ID = "0595dd9f-4fad-4460-a86a-f09573a8d8ee";
const ANDROID_PREVIEW_URL = `https://expo.dev/accounts/arboros/projects/arbor-mobile/builds/${ANDROID_PREVIEW_BUILD_ID}`;

function getAndroidPreviewUrl() {
  return process.env.EAS_ANDROID_PREVIEW_URL || ANDROID_PREVIEW_URL;
}

module.exports = {
  ANDROID_PREVIEW_BUILD_ID,
  ANDROID_PREVIEW_URL,
  getAndroidPreviewUrl,
};
