import React from 'react';
import Svg, {Path} from 'react-native-svg';

interface PauseIconProps {
  size?: number;
  color?: string;
}

export default function PauseIcon({size = 24, color = 'currentColor'}: PauseIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path fill={color} d="M11 17V7H8v10zm5 0V7h-3v10z" />
    </Svg>
  );
}
