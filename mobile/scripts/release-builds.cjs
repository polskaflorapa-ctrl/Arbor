const ANDROID_PREVIEW_BUILD_ID = "11b7dd68-da12-424d-a893-1f403d7d29ea";
const ANDROID_PREVIEW_URL = `https://expo.dev/accounts/arboros/projects/arbor-mobile/builds/${ANDROID_PREVIEW_BUILD_ID}`;

function getAndroidPreviewUrl() {
  return process.env.EAS_ANDROID_PREVIEW_URL || ANDROID_PREVIEW_URL;
}

module.exports = {
  ANDROID_PREVIEW_BUILD_ID,
  ANDROID_PREVIEW_URL,
  getAndroidPreviewUrl,
};
