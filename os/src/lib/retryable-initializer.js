function createRetryableInitializer(initialize) {
  if (typeof initialize !== 'function') {
    throw new TypeError('createRetryableInitializer requires an initializer function');
  }

  let pending;

  return function initializeOnce() {
    if (!pending) {
      const attempt = Promise.resolve().then(initialize);
      pending = attempt;
      attempt.then(undefined, () => {
        if (pending === attempt) {
          pending = undefined;
        }
      });
    }

    return pending;
  };
}

module.exports = {
  createRetryableInitializer,
};
