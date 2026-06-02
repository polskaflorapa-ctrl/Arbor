const ANDROID_PREVIEW_BUILD_ID = "4edddcd1-6109-48d4-ba8b-6e8960de5903";
const ANDROID_PREVIEW_URL = `https://expo.dev/accounts/arboros/projects/arbor-mobile/builds/${ANDROID_PREVIEW_BUILD_ID}`;

function getAndroidPreviewUrl() {
  return process.env.EAS_ANDROID_PREVIEW_URL || ANDROID_PREVIEW_URL;
}

module.exports = {
  ANDROID_PREVIEW_BUILD_ID,
  ANDROID_PREVIEW_URL,
  getAndroidPreviewUrl,
};
