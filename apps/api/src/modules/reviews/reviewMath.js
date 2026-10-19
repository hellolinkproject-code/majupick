/** D-22: 소수 첫째 자리. 리뷰 0건이면 null(0점으로 위장하지 않음). */
export function averageRating(sum, count) {
  if (count <= 0) return null;
  return Math.round((sum / count) * 10) / 10;
}
