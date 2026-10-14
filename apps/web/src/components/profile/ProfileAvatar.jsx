import { useState } from 'react';
import { profileImageSrc } from '../../lib/profileApi.js';

/** 이미지가 없거나(삭제 포함) 불러오지 못하면 이름 첫 글자로 된 기본 이미지를 보여 준다. */
export function ProfileAvatar({ name, imageUrl }) {
  const src = profileImageSrc(imageUrl);
  const [failedSrc, setFailedSrc] = useState(null);

  if (src && src !== failedSrc) {
    return (
      <img
        className="profile-image__avatar"
        src={src}
        alt={`${name} 프로필 이미지`}
        onError={() => setFailedSrc(src)}
      />
    );
  }
  return (
    <div
      className="profile-image__avatar profile-image__placeholder"
      role="img"
      aria-label="기본 프로필 이미지"
    >
      {name.trim().charAt(0) || '?'}
    </div>
  );
}
