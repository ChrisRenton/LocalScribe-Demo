import React, {useEffect, useRef} from 'react';
import {View, Animated} from 'react-native';

interface RecordingAnimationProps {
  isActive: boolean;
  size?: number;
}

export default function RecordingAnimation({
  isActive,
  size = 80,
}: RecordingAnimationProps) {
  const pulseAnims = useRef([
    {scale: new Animated.Value(0.5), opacity: new Animated.Value(0)},
    {scale: new Animated.Value(0.5), opacity: new Animated.Value(0)},
    {scale: new Animated.Value(0.5), opacity: new Animated.Value(0)},
  ]).current;

  const waveAnims = useRef(
    Array.from({length: 5}, () => new Animated.Value(0.2)),
  ).current;

  useEffect(() => {
    if (isActive) {
      const pulseAnimations = pulseAnims.map(anim =>
        Animated.loop(
          Animated.parallel([
            Animated.sequence([
              Animated.timing(anim.opacity, {
                toValue: 0.7,
                duration: 0,
                useNativeDriver: true,
              }),
              Animated.timing(anim.opacity, {
                toValue: 0,
                duration: 2000,
                useNativeDriver: true,
              }),
            ]),
            Animated.sequence([
              Animated.timing(anim.scale, {
                toValue: 0.5,
                duration: 0,
                useNativeDriver: true,
              }),
              Animated.timing(anim.scale, {
                toValue: 1.5,
                duration: 2000,
                useNativeDriver: true,
              }),
            ]),
          ]),
        ),
      );

      const waveAnimations = waveAnims.map((anim, index) =>
        Animated.loop(
          Animated.sequence([
            Animated.timing(anim, {
              toValue: 1,
              duration: 500 + index * 100,
              useNativeDriver: true,
            }),
            Animated.timing(anim, {
              toValue: 0.2,
              duration: 500 + index * 100,
              useNativeDriver: true,
            }),
          ]),
        ),
      );

      pulseAnimations.forEach((anim, index) => {
        setTimeout(() => anim.start(), index * 500);
      });
      waveAnimations.forEach((anim, index) => {
        setTimeout(() => anim.start(), index * 100);
      });

      return () => {
        pulseAnimations.forEach(a => a.stop());
        waveAnimations.forEach(a => a.stop());
      };
    } else {
      pulseAnims.forEach(anim => {
        Animated.parallel([
          Animated.timing(anim.scale, {
            toValue: 0.5,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(anim.opacity, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }),
        ]).start();
      });
      waveAnims.forEach(anim => {
        Animated.timing(anim, {
          toValue: 0.2,
          duration: 200,
          useNativeDriver: true,
        }).start();
      });
    }
  }, [isActive, pulseAnims, waveAnims]);

  const centerSize = size * 0.6;

  return (
    <View
      style={{
        width: size,
        height: size,
        justifyContent: 'center',
        alignItems: 'center',
      }}>
      {pulseAnims.map((anim, index) => (
        <Animated.View
          key={`ring-${index}`}
          style={{
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 2,
            borderColor: '#FF3B30',
            opacity: anim.opacity,
            transform: [{scale: anim.scale}],
          }}
        />
      ))}
      <View
        style={{
          position: 'absolute',
          width: centerSize,
          height: centerSize,
          borderRadius: centerSize / 2,
          backgroundColor: '#FFF5F5',
          borderWidth: 2,
          borderColor: '#FFE5E5',
          justifyContent: 'center',
          alignItems: 'center',
        }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            height: '50%',
            gap: 3,
          }}>
          {waveAnims.map((anim, index) => (
            <Animated.View
              key={`bar-${index}`}
              style={{
                width: 3,
                height: '100%',
                backgroundColor: '#FF3B30',
                borderRadius: 2,
                transform: [{scaleY: anim}],
              }}
            />
          ))}
        </View>
      </View>
    </View>
  );
}
