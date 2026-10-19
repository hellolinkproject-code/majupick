/** 평균 별점 표시(D-22 제안: 소수 첫째 자리). 0건이면 null. */
export function formatAverageRating(average) {
  if (average == null || Number.isNaN(Number(average))) return null;
  return Number(average).toFixed(1);
}
