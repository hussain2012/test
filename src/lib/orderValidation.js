export const discountApplicationPending = (enteredCode, appliedCode) => {
  const entered = String(enteredCode || '').trim().toUpperCase();
  const applied = String(appliedCode || '').trim().toUpperCase();
  return entered !== '' && entered !== applied;
};
