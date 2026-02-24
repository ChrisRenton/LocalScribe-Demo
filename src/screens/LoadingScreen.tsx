import React, {useEffect, useRef} from 'react';
import {
  View,
  Text,
  Animated,
  ActivityIndicator,
} from 'react-native';
import SafeScreen from '../components/SafeScreen';
import {DownloadProgress} from '../services/LlamaService';

interface LoadingScreenProps {
  asrStatus: string;
  llmStatus: string;
  downloadProgress: DownloadProgress | null;
  loadProgress: number;
  llmError: string | null;
  asrError: string | null;
  encryptionStatus?: 'pending' | 'ready' | 'error';
}

export default function LoadingScreen({
  asrStatus,
  llmStatus,
  downloadProgress,
  loadProgress,
  llmError,
  asrError,
  encryptionStatus = 'pending',
}: LoadingScreenProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [pulseAnim]);

  const normalizedLoad = loadProgress > 1 ? loadProgress / 100 : loadProgress;

  const steps = [
    {
      label: 'Encryption & Database',
      done: encryptionStatus === 'ready',
      active: encryptionStatus === 'pending',
      error: encryptionStatus === 'error',
      detail:
        encryptionStatus === 'ready'
          ? 'AES-256 SQLCipher ready'
          : encryptionStatus === 'error'
          ? 'Encryption failed'
          : 'Initializing secure storage...',
    },
    {
      label: 'Speech Recognition',
      done: asrStatus === 'ready',
      active: asrStatus === 'loading',
      error: asrStatus === 'error',
      detail:
        asrStatus === 'loading'
          ? 'Loading...'
          : asrStatus === 'ready'
          ? 'Ready'
          : asrStatus === 'error'
          ? asrError || 'Error'
          : 'Waiting',
    },
    {
      label: 'Downloading Models',
      done: llmStatus === 'loading' || llmStatus === 'ready',
      active: !!downloadProgress || llmStatus === 'downloading',
      error: llmStatus === 'error',
      detail: downloadProgress
        ? `Downloading ${downloadProgress.file} — ${Math.min(downloadProgress.progress, 100).toFixed(0)}%`
        : llmStatus === 'downloading'
        ? 'Starting download...'
        : llmStatus === 'loading' || llmStatus === 'ready'
        ? 'Ready'
        : llmStatus === 'error'
        ? llmError || 'Error'
        : 'Waiting',
    },
    {
      label: 'Loading into memory',
      done: llmStatus === 'ready',
      active: llmStatus === 'loading',
      error: false,
      detail:
        llmStatus === 'loading'
          ? `${Math.min(normalizedLoad * 100, 100).toFixed(0)}%`
          : llmStatus === 'ready'
          ? 'Ready'
          : 'Waiting',
    },
  ];

  const overallProgress = Math.min(
    1,
    (steps[0].done ? 0.15 : steps[0].active ? 0.07 : 0) +
      (steps[1].done ? 0.2 : steps[1].active ? 0.1 : 0) +
      (steps[2].done
        ? 0.3
        : steps[2].active
        ? downloadProgress
          ? Math.min(downloadProgress.progress / 100, 1) * 0.3
          : 0.1
        : 0) +
      (steps[3].done ? 0.35 : steps[3].active ? normalizedLoad * 0.35 : 0),
  );

  return (
    <SafeScreen>
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 40,
        }}>
        <Animated.View
          style={{transform: [{scale: pulseAnim}], marginBottom: 24}}>
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              backgroundColor: '#FFF5F5',
              borderWidth: 2,
              borderColor: '#FFE5E5',
              justifyContent: 'center',
              alignItems: 'center',
            }}>
            <Text style={{fontSize: 36}}>+</Text>
          </View>
        </Animated.View>

        <Text
          style={{
            fontSize: 28,
            fontWeight: '300',
            color: '#1a1a1a',
            marginBottom: 4,
          }}>
          LocalScribe — DEMO
        </Text>
        <Text style={{fontSize: 15, color: '#999', marginBottom: 40}}>
          Preparing secure environment
        </Text>

        {/* Progress bar */}
        <View
          style={{
            width: '100%',
            height: 4,
            backgroundColor: '#f0f0f0',
            borderRadius: 2,
            marginBottom: 32,
            overflow: 'hidden',
          }}>
          <View
            style={{
              height: '100%',
              backgroundColor: '#FF3B30',
              borderRadius: 2,
              width: `${Math.min(overallProgress * 100, 100)}%`,
            }}
          />
        </View>

        {/* Steps */}
        <View style={{width: '100%', gap: 14}}>
          {steps.map((step, i) => (
            <View
              key={i}
              style={{flexDirection: 'row', alignItems: 'center', gap: 12}}>
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: step.done
                    ? '#059669'
                    : step.active
                    ? '#FF3B30'
                    : step.error
                    ? '#DC2626'
                    : '#f0f0f0',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}>
                {step.done ? (
                  <Text
                    style={{color: '#fff', fontWeight: '700', fontSize: 11}}>
                    {'OK'}
                  </Text>
                ) : step.active ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : step.error ? (
                  <Text style={{color: '#fff', fontWeight: '700', fontSize: 13}}>
                    !
                  </Text>
                ) : (
                  <Text
                    style={{color: '#999', fontWeight: '600', fontSize: 13}}>
                    {i + 1}
                  </Text>
                )}
              </View>
              <View style={{flex: 1}}>
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: '500',
                    color: step.done ? '#059669' : '#1a1a1a',
                  }}>
                  {step.label}
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: step.error ? '#DC2626' : '#999',
                    marginTop: 1,
                  }}>
                  {step.detail}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {encryptionStatus === 'ready' && (
          <View
            style={{
              marginTop: 28,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: '#E8F5E9',
              paddingHorizontal: 14,
              paddingVertical: 6,
              borderRadius: 16,
            }}>
            <Text style={{fontSize: 12}}>🔒</Text>
            <Text
              style={{fontSize: 12, color: '#2E7D32', fontWeight: '600'}}>
              AES-256 encryption active
            </Text>
          </View>
        )}

        {(llmError || asrError) && (
          <Text
            style={{
              color: '#DC2626',
              fontSize: 13,
              textAlign: 'center',
              marginTop: 24,
            }}>
            {llmError || asrError}
          </Text>
        )}
      </View>
    </SafeScreen>
  );
}
