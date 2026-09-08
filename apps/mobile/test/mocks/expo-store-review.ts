/** Stand-in for `expo-store-review` (§12.10). */
export const storeReviewMock = {
  available: true,
  requests: 0,
  throwOnRequest: false,
};

export function resetStoreReviewMock(): void {
  storeReviewMock.available = true;
  storeReviewMock.requests = 0;
  storeReviewMock.throwOnRequest = false;
}

export async function hasAction(): Promise<boolean> {
  return storeReviewMock.available;
}

export async function requestReview(): Promise<void> {
  if (storeReviewMock.throwOnRequest) throw new Error('store declined');
  storeReviewMock.requests += 1;
}
