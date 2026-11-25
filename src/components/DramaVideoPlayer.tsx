import React, { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Maximize,
  Minimize,
  MoveHorizontal,
  Pause,
  Play,
  RectangleHorizontal,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { AppLocale } from '../shared/types.ts';
import { getCopy } from '../utils/i18n.ts';
import {
  getConfiguredApiBaseUrl,
  isStaticHostEnvironment,
  resolveApiUrl,
} from '../utils/apiConfig.ts';
import { formatVideoDuration } from '../server/mediaParser.ts';
import { isYouTubeVideoId } from '../server/youtubeParser.ts';
import {
  buildHiddenYouTubePlayerVars,
  loadYouTubeIframeApi,
  YT_STATE,
  type YtPlayerInstance,
} from '../utils/youtubeIframeLoader.ts';
import {
  buildXtreamHlsPlaylistUrl,
  buildXtreamStreamSeekUrl,
  computeControlsTapOutcome,
  getHiddenYouTubeHostClass,
  getXtreamAdaptiveFallbackUrl,
  getXtreamMetaUrlFromStream,
  isTimeInBufferedRanges,
  resolveFastPlaybackMode,
  resolveXtreamPlaybackErrorRecovery,
} from '../utils/playerControls.ts';

export interface PlayerStreamErrorInfo {
  status?: number | null;
  message: string;
}

interface DramaVideoPlayerProps {
  videoId: string;
  streamUrl: string;
  title: string;
  thumbnail: string;
  knownDurationSeconds?: number;
  locale: AppLocale;
  theaterMode: boolean;
  retrySignal?: number;
  onStreamError?: (info: PlayerStreamErrorInfo) => void;
  onStreamRecovered?: () => void;
  onToggleTheater: () => void;
  onBack?: () => void;
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2];

export function DramaVideoPlayer({
  videoId,
  streamUrl,
  title,
  thumbnail,
  knownDurationSeconds = 0,
  locale,
  theaterMode,
  retrySignal = 0,
  onStreamError,
  onStreamRecovered,
  onToggleTheater,
  onBack,
}: DramaVideoPlayerProps) {
  const t = getCopy(locale);
  const BackArrow = locale === 'ar' ? ArrowRight : ArrowLeft;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ytHostRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<YtPlayerInstance | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const onStreamErrorRef = useRef(onStreamError);
  const onStreamRecoveredRef = useRef(onStreamRecovered);
  onStreamErrorRef.current = onStreamError;
  onStreamRecoveredRef.current = onStreamRecovered;

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [ytEngineActive, setYtEngineActive] = useState(false);
  const [dmEmbedActive, setDmEmbedActive] = useState(false);
  const [ytHasStartedPlayback, setYtHasStartedPlayback] = useState(false);
  const [ytRevealHold, setYtRevealHold] = useState(false);
  const [ytEnded, setYtEnded] = useState(false);
  const revealHoldTimerRef = useRef<number | null>(null);
  const isMutedRef = useRef(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [remuxSeekOffset, setRemuxSeekOffset] = useState(0);
  const [scrubPreviewTime, setScrubPreviewTime] = useState<number | null>(null);
  const [pendingSeekTarget, setPendingSeekTarget] = useState<number | null>(null);
  const [duration, setDuration] = useState(knownDurationSeconds > 0 ? knownDurationSeconds : 0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [fillScreen, setFillScreen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  const fallbackHandlerRef = useRef<(() => boolean) | null>(null);
  const seekHandlerRef = useRef<((targetSeconds: number) => void) | null>(null);
  const adaptiveSwitchHandlerRef = useRef<(() => void) | null>(null);
  const activeUrlRef = useRef<string>(streamUrl);
  const remuxSeekOffsetRef = useRef(0);
  const scrubPreviewRef = useRef<number | null>(null);
  const isPointerScrubbingRef = useRef(false);
  const pendingSeekTargetRef = useRef<number | null>(null);
  const keyboardSeekTimerRef = useRef<number | null>(null);
  const seekDebounceTimerRef = useRef<number | null>(null);
  const lastPointerCommitAtRef = useRef(0);
  const xtreamHlsLowRef = useRef(false);
  const recoveryRetryTimerRef = useRef<number | null>(null);
  const xtreamRecoveryStepRef = useRef(0);
  const lastProgressAtRef = useRef(0);
  const startupWatchdogRef = useRef<number | null>(null);
  const stallWatchdogRef = useRef<number | null>(null);
  const isPlayingRef = useRef(false);
  const ytEngineActiveRef = useRef(false);
  const durationRef = useRef(knownDurationSeconds > 0 ? knownDurationSeconds : 0);
  const volumeRef = useRef(volume);
  const playbackRateRef = useRef(playbackRate);

  remuxSeekOffsetRef.current = remuxSeekOffset;
  scrubPreviewRef.current = scrubPreviewTime;
  pendingSeekTargetRef.current = pendingSeekTarget;
  isPlayingRef.current = isPlaying;
  ytEngineActiveRef.current = ytEngineActive;
  durationRef.current = Math.max(
    Number.isFinite(duration) && duration > 0 ? duration : 0,
    knownDurationSeconds > 0 ? knownDurationSeconds : 0,
  );
  volumeRef.current = volume;
  isMutedRef.current = isMuted;
  playbackRateRef.current = playbackRate;

  const clearHideTimer = () => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const bumpControlsVisibility = useCallback(() => {
    setControlsVisible(true);
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => {
      const vid = videoRef.current;
      const playingNow = ytEngineActiveRef.current
        ? isPlayingRef.current
        : Boolean(vid && !vid.paused);
      if (playingNow) {
        setControlsVisible(false);
      }
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      clearHideTimer();
    };
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    if (knownDurationSeconds > 0) {
      setDuration((prev) => (prev > 0 ? prev : knownDurationSeconds));
    }
  }, [knownDurationSeconds]);

  useEffect(() => {
    const metaUrl = getXtreamMetaUrlFromStream(streamUrl);
    if (!metaUrl || knownDurationSeconds > 0) return;

    let cancelled = false;
    void fetch(resolveApiUrl(metaUrl))
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { durationSeconds?: number };
      })
      .then((meta) => {
        if (cancelled) return;
        const dur = meta?.durationSeconds;
        if (typeof dur === 'number' && Number.isFinite(dur) && dur > 0) {
          setDuration((prev) => (prev > 0 ? prev : dur));
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [streamUrl, knownDurationSeconds, videoId]);

  // Resolve playback source: use direct/HLS stream when available, or seamlessly switch
  // to the concealed background YouTube engine for YouTube items while showing ONLY our custom UI.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    let cancelled = false;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    setYtEngineActive(false);
    setDmEmbedActive(false);
    setYtHasStartedPlayback(false);
    setYtRevealHold(false);
    if (revealHoldTimerRef.current) {
      window.clearTimeout(revealHoldTimerRef.current);
      revealHoldTimerRef.current = null;
    }
    setYtEnded(false);
    setIsPlaying(false);
    setIsBuffering(true);
    setHasError(false);
    setErrorStatus(null);
    setErrorDetail(null);
    setCurrentTime(0);
    setRemuxSeekOffset(0);
    setScrubPreviewTime(null);
    scrubPreviewRef.current = null;
    setPendingSeekTarget(null);
    pendingSeekTargetRef.current = null;
    isPointerScrubbingRef.current = false;
    setDuration(knownDurationSeconds > 0 ? knownDurationSeconds : 0);
    setBufferedEnd(0);
    setControlsVisible(true);
    xtreamRecoveryStepRef.current = 0;
    xtreamHlsLowRef.current = false;

    const nextSid = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

    let fallbackAttempted = false;
    const isLocalBlob = streamUrl.startsWith('blob:');
    const isServerItem = streamUrl.startsWith('/api/videos/item/');
    const canFallbackToHiddenYt = !isLocalBlob && isServerItem && isYouTubeVideoId(videoId);

    const reportStreamFailure = (status: number | null, message: string) => {
      if (cancelled) return;
      setYtEngineActive(false);
      setErrorStatus(status);
      setErrorDetail(message);
      setHasError(true);
      setIsBuffering(false);
      onStreamErrorRef.current?.({ status, message });
    };

    const activateHiddenYtEngine = () => {
      if (cancelled) return;
      video.pause();
      video.removeAttribute('src');
      video.load();
      setHasError(false);
      setErrorStatus(null);
      setErrorDetail(null);
      setIsBuffering(true);
      setYtHasStartedPlayback(false);
      setYtEnded(false);
      setYtEngineActive(true);
    };

    const clearXtreamWatchdogs = () => {
      if (seekDebounceTimerRef.current) {
        window.clearTimeout(seekDebounceTimerRef.current);
        seekDebounceTimerRef.current = null;
      }
      if (recoveryRetryTimerRef.current) {
        window.clearTimeout(recoveryRetryTimerRef.current);
        recoveryRetryTimerRef.current = null;
      }
      if (startupWatchdogRef.current) {
        window.clearTimeout(startupWatchdogRef.current);
        startupWatchdogRef.current = null;
      }
      if (stallWatchdogRef.current) {
        window.clearTimeout(stallWatchdogRef.current);
        stallWatchdogRef.current = null;
      }
    };

    const attachPlaybackSource = (resolvedUrl: string, isHlsSource: boolean) => {
      if (cancelled) return;
      clearXtreamWatchdogs();
      activeUrlRef.current = resolvedUrl;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      const trySilentFallback = (status: number | null, message: string): boolean => {
        if (!isLocalBlob && resolvedUrl.startsWith('/api/xtream/hls/')) {
          const baseAt =
            pendingSeekTargetRef.current !== null
              ? pendingSeekTargetRef.current
              : remuxSeekOffsetRef.current + (video.currentTime || 0);
          const clampedAt = Math.max(0, Math.floor(baseAt));
          if (!xtreamHlsLowRef.current) {
            xtreamHlsLowRef.current = true;
            const lowHlsUrl = buildXtreamHlsPlaylistUrl(streamUrl, {
              startSeconds: clampedAt,
              low: true,
              sessionId: nextSid(),
            });
            if (lowHlsUrl) {
              setHasError(false);
              setIsBuffering(true);
              setCurrentTime(0);
              remuxSeekOffsetRef.current = clampedAt;
              setRemuxSeekOffset(clampedAt);
              attachPlaybackSource(lowHlsUrl, true);
              return true;
            }
          }
          if (!fallbackAttempted) {
            fallbackAttempted = true;
            const remuxStreamUrl = buildXtreamStreamSeekUrl(
              streamUrl,
              `${streamUrl}&low=1`,
              clampedAt,
            );
            if (remuxStreamUrl) {
              setHasError(false);
              setIsBuffering(true);
              setCurrentTime(0);
              remuxSeekOffsetRef.current = clampedAt;
              setRemuxSeekOffset(clampedAt);
              attachPlaybackSource(remuxStreamUrl, false);
              return true;
            }
          }
        }
        if (
          !fallbackAttempted &&
          videoId &&
          !isLocalBlob &&
          resolvedUrl.startsWith('http')
        ) {
          fallbackAttempted = true;
          const fallbackEndpoint = isHlsSource
            ? `/api/videos/item/${encodeURIComponent(videoId)}/stream.m3u8`
            : `/api/videos/item/${encodeURIComponent(videoId)}/media.mp4`;
          attachPlaybackSource(fallbackEndpoint, isHlsSource);
          return true;
        }
        if (canFallbackToHiddenYt) {
          activateHiddenYtEngine();
          return true;
        }
        reportStreamFailure(status, message);
        return false;
      };

      adaptiveSwitchHandlerRef.current = () => {
        if (cancelled) return;
        const baseAt =
          pendingSeekTargetRef.current !== null
            ? pendingSeekTargetRef.current
            : remuxSeekOffsetRef.current + (video.currentTime || 0);
        const clamped = Math.max(0, Math.floor(baseAt));
        if (activeUrlRef.current.startsWith('/api/xtream/hls/')) {
          if (xtreamHlsLowRef.current) return;
          xtreamHlsLowRef.current = true;
          const lowHlsUrl = buildXtreamHlsPlaylistUrl(streamUrl, {
            startSeconds: clamped,
            low: true,
            sessionId: nextSid(),
          });
          if (!lowHlsUrl) return;
          xtreamRecoveryStepRef.current = 0;
          setHasError(false);
          setIsBuffering(true);
          setCurrentTime(0);
          remuxSeekOffsetRef.current = clamped;
          setRemuxSeekOffset(clamped);
          attachPlaybackSource(lowHlsUrl, true);
          return;
        }
        const lowUrl = getXtreamAdaptiveFallbackUrl(activeUrlRef.current, baseAt);
        if (!lowUrl) return;
        xtreamRecoveryStepRef.current = 0;
        setHasError(false);
        setIsBuffering(true);
        setCurrentTime(0);
        remuxSeekOffsetRef.current = clamped;
        setRemuxSeekOffset(clamped);
        attachPlaybackSource(lowUrl, false);
      };

      seekHandlerRef.current = (targetSeconds: number) => {
        const clamped = Math.max(0, Math.floor(targetSeconds));

        if (activeUrlRef.current.startsWith('/api/xtream/hls/')) {
          const localTarget = clamped - remuxSeekOffsetRef.current;
          const ranges: Array<{ start: number; end: number }> = [];
          for (let i = 0; i < video.buffered.length; i += 1) {
            ranges.push({ start: video.buffered.start(i), end: video.buffered.end(i) });
          }
          if (isTimeInBufferedRanges(localTarget, ranges, 0.5)) {
            if (seekDebounceTimerRef.current) {
              window.clearTimeout(seekDebounceTimerRef.current);
              seekDebounceTimerRef.current = null;
            }
            pendingSeekTargetRef.current = clamped;
            setPendingSeekTarget(clamped);
            lastProgressAtRef.current = Date.now();
            setHasError(false);
            setIsBuffering(false);
            video.currentTime = localTarget;
            setCurrentTime(localTarget);
            if (video.paused) {
              video
                .play()
                .then(() => {
                  setIsPlaying(true);
                  bumpControlsVisibility();
                })
                .catch(() => {});
            }
            return;
          }

          if (seekDebounceTimerRef.current) {
            window.clearTimeout(seekDebounceTimerRef.current);
            seekDebounceTimerRef.current = null;
          }
          xtreamRecoveryStepRef.current = 0;
          pendingSeekTargetRef.current = clamped;
          setPendingSeekTarget(clamped);
          lastProgressAtRef.current = Date.now();
          setHasError(false);
          setIsBuffering(true);
          setCurrentTime(0);
          setBufferedEnd(0);
          remuxSeekOffsetRef.current = clamped;
          setRemuxSeekOffset(clamped);
          seekDebounceTimerRef.current = window.setTimeout(() => {
            seekDebounceTimerRef.current = null;
            if (cancelled) return;
            const seekHlsUrl = buildXtreamHlsPlaylistUrl(streamUrl, {
              startSeconds: clamped,
              low: xtreamHlsLowRef.current,
              sessionId: nextSid(),
            });
            if (seekHlsUrl) {
              attachPlaybackSource(seekHlsUrl, true);
            }
          }, 90);
          return;
        }

        const seekUrl = buildXtreamStreamSeekUrl(streamUrl, activeUrlRef.current, clamped);
        if (!seekUrl) return;
        xtreamRecoveryStepRef.current = 0;
        pendingSeekTargetRef.current = clamped;
        setPendingSeekTarget(clamped);
        lastProgressAtRef.current = Date.now();
        setHasError(false);
        setIsBuffering(true);
        setCurrentTime(0);
        remuxSeekOffsetRef.current = clamped;
        setRemuxSeekOffset(clamped);
        attachPlaybackSource(seekUrl, false);
      };

      fallbackHandlerRef.current = () => {
        if (!isLocalBlob && resolvedUrl.startsWith('/api/xtream/hls/')) {
          return trySilentFallback(null, t.streamAccessErrorLabel);
        }
        if (!isLocalBlob && resolvedUrl.startsWith('/api/xtream/stream/')) {
          const resumeAt =
            pendingSeekTargetRef.current !== null
              ? pendingSeekTargetRef.current
              : remuxSeekOffsetRef.current + (video.currentTime || 0);
          const action = resolveXtreamPlaybackErrorRecovery({
            currentUrl: resolvedUrl,
            recoveryStep: xtreamRecoveryStepRef.current,
            resumeAtSeconds: resumeAt,
          });
          if (action) {
            xtreamRecoveryStepRef.current += 1;
            setHasError(false);
            setIsBuffering(true);
            if (action.preservedStartSeconds > 0) {
              pendingSeekTargetRef.current = action.preservedStartSeconds;
              setPendingSeekTarget(action.preservedStartSeconds);
              setCurrentTime(0);
              remuxSeekOffsetRef.current = action.preservedStartSeconds;
              setRemuxSeekOffset(action.preservedStartSeconds);
            }
            if (recoveryRetryTimerRef.current) {
              window.clearTimeout(recoveryRetryTimerRef.current);
            }
            recoveryRetryTimerRef.current = window.setTimeout(() => {
              recoveryRetryTimerRef.current = null;
              if (!cancelled) {
                attachPlaybackSource(action.nextUrl, false);
              }
            }, action.delayMs);
            return true;
          }
        }
        if (!fallbackAttempted && videoId && !isLocalBlob && resolvedUrl.startsWith('http')) {
          fallbackAttempted = true;
          const fallbackEndpoint = isHlsSource
            ? `/api/videos/item/${encodeURIComponent(videoId)}/stream.m3u8`
            : `/api/videos/item/${encodeURIComponent(videoId)}/media.mp4`;
          attachPlaybackSource(fallbackEndpoint, isHlsSource);
          return true;
        }
        if (canFallbackToHiddenYt) {
          activateHiddenYtEngine();
          return true;
        }
        return false;
      };

      if (isHlsSource && Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 30,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          manifestLoadingTimeOut: 20000,
          manifestLoadingMaxRetry: 3,
          fragLoadingTimeOut: 20000,
          fragLoadingMaxRetry: 4,
          levelLoadingTimeOut: 20000,
          levelLoadingMaxRetry: 4,
        });
        hlsRef.current = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setIsBuffering(false);
          onStreamRecoveredRef.current?.();
          if (durationRef.current === 0 && streamUrl.startsWith('/api/xtream/')) {
            const metaUrl = getXtreamMetaUrlFromStream(streamUrl);
            if (metaUrl) {
              void fetch(metaUrl)
                .then(async (r) => (r.ok ? ((await r.json()) as { durationSeconds?: number }) : null))
                .then((m) => {
                  const dur = m?.durationSeconds;
                  if (!cancelled && typeof dur === 'number' && Number.isFinite(dur) && dur > 0) {
                    setDuration((prev) => (prev > 0 ? prev : dur));
                  }
                })
                .catch(() => {});
            }
          }
          video.playbackRate = playbackRateRef.current;
          video
            .play()
            .then(() => {
              setIsPlaying(true);
              setIsBuffering(false);
              bumpControlsVisibility();
            })
            .catch(() => {
              video.muted = true;
              setIsMuted(true);
              video
                .play()
                .then(() => {
                  setIsPlaying(true);
                  setIsBuffering(false);
                  bumpControlsVisibility();
                })
                .catch(() => {
                  setIsPlaying(false);
                });
            });
        });

        let networkRetries = 0;
        let mediaRetries = 0;
        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (data.fatal) {
            const httpCode =
              typeof data.response?.code === 'number' && data.response.code > 0
                ? data.response.code
                : null;
            if (
              !resolvedUrl.startsWith('/api/xtream/hls/') &&
              (httpCode === 403 || httpCode === 404 || httpCode === 401 || httpCode === 0)
            ) {
              hls.destroy();
              trySilentFallback(httpCode, t.streamAccessErrorLabel);
              return;
            }
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 3) {
              networkRetries += 1;
              window.setTimeout(() => {
                if (!cancelled && hlsRef.current === hls) {
                  hls.startLoad();
                }
              }, 350);
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries < 1) {
              mediaRetries += 1;
              hls.recoverMediaError();
            } else {
              hls.destroy();
              trySilentFallback(httpCode, t.streamAccessErrorLabel);
            }
          }
        });

        hls.loadSource(resolveApiUrl(resolvedUrl));
        hls.attachMedia(video);
      } else {
        video.src = resolveApiUrl(resolvedUrl);
        video.load();
        lastProgressAtRef.current = Date.now();
        if (
          resolvedUrl.startsWith('/api/xtream/stream/') &&
          !/(?:[?&])low=(?:1|true)\b/.test(resolvedUrl)
        ) {
          const isExplicitSeekLoad = /(?:[?&])start=\d+/.test(resolvedUrl);
          const watchdogWaitMs = isExplicitSeekLoad ? 9500 : 7000;
          startupWatchdogRef.current = window.setTimeout(() => {
            if (cancelled || video.paused || isPointerScrubbingRef.current) return;
            if (video.readyState < 2 && video.currentTime < 0.1) {
              adaptiveSwitchHandlerRef.current?.();
            }
          }, watchdogWaitMs);
        }
        video
          .play()
          .then(() => {
            setIsPlaying(true);
            setIsBuffering(false);
            onStreamRecoveredRef.current?.();
            bumpControlsVisibility();
          })
          .catch(() => {
            video.muted = true;
            setIsMuted(true);
            video
              .play()
              .then(() => {
                setIsPlaying(true);
                setIsBuffering(false);
                onStreamRecoveredRef.current?.();
                bumpControlsVisibility();
              })
              .catch(() => {
                clearXtreamWatchdogs();
                setIsPlaying(false);
                setIsBuffering(false);
              });
          });
      }
    };

    const strategy = resolveFastPlaybackMode({
      videoId,
      streamUrl,
      isYouTubeId: isYouTubeVideoId(videoId),
    });

    if (strategy.mode === 'youtube_fast_race') {
      // Zero-wait startup: mount the concealed YouTube engine immediately using the pre-warmed IFrame API;
      // if an embed restriction error occurs, onError transparently falls back to /resolve.
      fallbackHandlerRef.current = () => {
        if (fallbackAttempted || !videoId) return false;
        fallbackAttempted = true;
        const qs = new URLSearchParams({ hl: locale });
        if (title.trim()) qs.set('title', title.trim());
        setYtEngineActive(false);
        setIsBuffering(true);
        void fetch(resolveApiUrl(`/api/videos/item/${encodeURIComponent(videoId)}/resolve?${qs.toString()}`))
          .then(async (res) => {
            if (cancelled) return;
            if (!res.ok) {
              reportStreamFailure(res.status, t.streamAccessErrorLabel);
              return;
            }
            const data = (await res.json()) as {
              playable?: boolean;
              kind?: 'mp4' | 'hls';
              url?: string;
              reason?: string;
            };
            if (cancelled) return;
            if (!data.playable || !data.url) {
              reportStreamFailure(403, data.reason || t.streamAccessErrorLabel);
              return;
            }
            attachPlaybackSource(data.url, data.kind === 'hls' || data.url.includes('.m3u8'));
          })
          .catch(() => {
            if (!cancelled) reportStreamFailure(403, t.streamAccessErrorLabel);
          });
        return true;
      };
      activateHiddenYtEngine();
    } else if (strategy.mode === 'resolve_then_direct' && videoId) {
      const isStaticDm = !getConfiguredApiBaseUrl() && isStaticHostEnvironment() && /^x[a-z0-9]{4,12}$/i.test(videoId);
      if (isStaticDm) {
        setHasError(false);
        setIsBuffering(false);
        setDmEmbedActive(true);
        onStreamRecoveredRef.current?.();
      } else {
        const qs = new URLSearchParams({ hl: locale });
        if (title.trim()) qs.set('title', title.trim());
        void fetch(resolveApiUrl(`/api/videos/item/${encodeURIComponent(videoId)}/resolve?${qs.toString()}`))
          .then(async (res) => {
            if (!res.ok) {
              if (res.status === 404 && /^x[a-z0-9]{4,12}$/i.test(videoId) && !getConfiguredApiBaseUrl()) {
                setHasError(false);
                setIsBuffering(false);
                setDmEmbedActive(true);
                onStreamRecoveredRef.current?.();
                return;
              }
              if (canFallbackToHiddenYt) {
                activateHiddenYtEngine();
                return;
              }
              reportStreamFailure(res.status, t.streamAccessErrorLabel);
              return;
            }
            const data = (await res.json()) as {
              playable?: boolean;
              kind?: 'mp4' | 'hls';
              url?: string;
              code?: string;
              reason?: string;
            };
            if (cancelled) return;
            if (!data.playable || !data.url) {
              if (canFallbackToHiddenYt) {
                activateHiddenYtEngine();
                return;
              }
              const inferredStatus = data.code === 'STREAM_UNAVAILABLE' ? 404 : null;
              reportStreamFailure(inferredStatus, data.reason || t.streamAccessErrorLabel);
              return;
            }
            attachPlaybackSource(data.url, data.kind === 'hls' || data.url.includes('.m3u8'));
          })
          .catch(() => {
            if (cancelled) return;
            if (canFallbackToHiddenYt) {
              activateHiddenYtEngine();
              return;
            }
            reportStreamFailure(null, t.streamAccessErrorLabel);
          });
      }
    } else {
      const xtreamHlsUrl =
        !isLocalBlob && streamUrl.startsWith('/api/xtream/stream/')
          ? buildXtreamHlsPlaylistUrl(streamUrl, { startSeconds: 0, sessionId: nextSid() })
          : null;
      if (
        xtreamHlsUrl &&
        (Hls.isSupported() || Boolean(video.canPlayType('application/vnd.apple.mpegurl')))
      ) {
        attachPlaybackSource(xtreamHlsUrl, true);
      } else {
        attachPlaybackSource(streamUrl, !isLocalBlob && streamUrl.includes('.m3u8'));
      }
    }

    return () => {
      cancelled = true;
      clearXtreamWatchdogs();
      fallbackHandlerRef.current = null;
      adaptiveSwitchHandlerRef.current = null;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [videoId, streamUrl, locale, retrySignal]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mount and drive the concealed YouTube engine behind DramaVideoPlayer controls
  useEffect(() => {
    if (!ytEngineActive || !isYouTubeVideoId(videoId)) return;
    const hostContainer = ytHostRef.current;
    if (!hostContainer) return;

    let cancelled = false;
    let firstPlayTriggered = false;
    let progressTimer: number | null = null;
    let autoplayCheckTimer: number | null = null;

    hostContainer.innerHTML = '';
    const mountDiv = document.createElement('div');
    mountDiv.style.width = '100%';
    mountDiv.style.height = '100%';
    mountDiv.style.pointerEvents = 'none';
    hostContainer.appendChild(mountDiv);

    void loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled) return;

        const player = new YT.Player(mountDiv, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: buildHiddenYouTubePlayerVars(window.location.origin),
          events: {
            onReady: ({ target }) => {
              if (cancelled) return;
              const iframeEl = hostContainer.querySelector('iframe');
              if (iframeEl) {
                iframeEl.style.pointerEvents = 'none';
                iframeEl.style.border = '0';
                iframeEl.setAttribute('tabindex', '-1');
                iframeEl.setAttribute('aria-hidden', 'true');
              }

              if (isMutedRef.current) {
                target.mute();
              } else {
                target.unMute();
                target.setVolume(Math.round(volumeRef.current * 100));
              }
              try {
                target.setPlaybackRate(playbackRateRef.current);
              } catch {
                // ignore rate error prior to start
              }

              const initialDur = target.getDuration();
              if (Number.isFinite(initialDur) && initialDur > 0) {
                setDuration(initialDur);
              }

              target.playVideo();

              // If browser autoplay policy blocks initial playback, clear spinner cleanly so custom Play shows
              autoplayCheckTimer = window.setTimeout(() => {
                if (cancelled) return;
                try {
                  const st = target.getPlayerState();
                  if (st !== YT_STATE.PLAYING && st !== YT_STATE.BUFFERING) {
                    setIsBuffering(false);
                    setIsPlaying(false);
                    setControlsVisible(true);
                  }
                } catch {
                  setIsBuffering(false);
                }
              }, 1500);
            },
            onStateChange: ({ data, target }) => {
              if (cancelled) return;
              if (autoplayCheckTimer) {
                window.clearTimeout(autoplayCheckTimer);
                autoplayCheckTimer = null;
              }
              if (data === YT_STATE.PLAYING) {
                if (!firstPlayTriggered) {
                  firstPlayTriggered = true;
                  setYtRevealHold(true);
                  if (revealHoldTimerRef.current) {
                    window.clearTimeout(revealHoldTimerRef.current);
                  }
                  revealHoldTimerRef.current = window.setTimeout(() => {
                    if (!cancelled) setYtRevealHold(false);
                  }, 450);
                }
                setYtHasStartedPlayback(true);
                setYtEnded(false);
                setIsBuffering(false);
                setIsPlaying(true);
                isPlayingRef.current = true;
                onStreamRecoveredRef.current?.();
                const d = target.getDuration();
                if (Number.isFinite(d) && d > 0) {
                  setDuration(d);
                }
                bumpControlsVisibility();
              } else if (data === YT_STATE.BUFFERING) {
                setIsBuffering(true);
              } else if (data === YT_STATE.PAUSED) {
                setIsBuffering(false);
                setIsPlaying(false);
                isPlayingRef.current = false;
                setControlsVisible(true);
                clearHideTimer();
              } else if (data === YT_STATE.ENDED) {
                setYtEnded(true);
                setIsBuffering(false);
                setIsPlaying(false);
                isPlayingRef.current = false;
                setControlsVisible(true);
                clearHideTimer();
              } else if (data === YT_STATE.CUED) {
                setIsBuffering(false);
                setIsPlaying(false);
                isPlayingRef.current = false;
              }
            },
            onError: () => {
              if (cancelled) return;
              if (fallbackHandlerRef.current?.()) {
                return;
              }
              setYtEngineActive(false);
              setErrorStatus(403);
              setErrorDetail(t.streamAccessErrorLabel);
              setHasError(true);
              setIsBuffering(false);
              onStreamErrorRef.current?.({ status: 403, message: t.streamAccessErrorLabel });
            },
          },
        });

        ytPlayerRef.current = player;

        progressTimer = window.setInterval(() => {
          if (cancelled || !ytPlayerRef.current) return;
          try {
            const cur = ytPlayerRef.current.getCurrentTime();
            const dur = ytPlayerRef.current.getDuration();
            const frac = ytPlayerRef.current.getVideoLoadedFraction();
            if (Number.isFinite(cur) && cur >= 0) {
              setCurrentTime(cur);
            }
            if (Number.isFinite(dur) && dur > 0) {
              setDuration(dur);
              if (Number.isFinite(frac) && frac >= 0) {
                setBufferedEnd(dur * frac);
              }
            }
          } catch {
            // ignore transient bridge errors
          }
        }, 250);
      })
      .catch(() => {
        if (cancelled) return;
        setYtEngineActive(false);
        setErrorStatus(null);
        setErrorDetail(t.streamAccessErrorLabel);
        setHasError(true);
        setIsBuffering(false);
        onStreamErrorRef.current?.({ status: null, message: t.streamAccessErrorLabel });
      });

    return () => {
      cancelled = true;
      if (progressTimer) window.clearInterval(progressTimer);
      if (autoplayCheckTimer) window.clearTimeout(autoplayCheckTimer);
      if (revealHoldTimerRef.current) {
        window.clearTimeout(revealHoldTimerRef.current);
        revealHoldTimerRef.current = null;
      }
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // ignore destroy cleanup error
        }
        ytPlayerRef.current = null;
      }
      hostContainer.innerHTML = '';
    };
  }, [ytEngineActive, videoId, bumpControlsVisibility, t.streamAccessErrorLabel]);

  const triggerHiddenYtPlay = () => {
    const player = ytPlayerRef.current;
    if (!player) return;
    if (ytEnded) {
      player.seekTo(0, true);
      setYtEnded(false);
    }
    setIsBuffering(true);
    player.playVideo();
    bumpControlsVisibility();

    window.setTimeout(() => {
      if (!ytPlayerRef.current || ytPlayerRef.current !== player) return;
      try {
        const st = player.getPlayerState();
        if (st !== YT_STATE.PLAYING && st !== YT_STATE.BUFFERING) {
          player.mute();
          setIsMuted(true);
          player.playVideo();
        }
      } catch {
        // ignore player state query errors
      }
    }, 900);
  };

  const handleVideoSurfaceClick = () => {
    if (ytEngineActive && ytPlayerRef.current) {
      if (!isPlaying) {
        triggerHiddenYtPlay();
        return;
      }
      const outcome = computeControlsTapOutcome({ isPlaying: true, controlsVisible });
      if (outcome.armAutoHideTimer) {
        bumpControlsVisibility();
      } else {
        setControlsVisible(outcome.nextVisible);
        clearHideTimer();
      }
      return;
    }

    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video
        .play()
        .then(() => {
          setIsPlaying(true);
          bumpControlsVisibility();
        })
        .catch(() => {
          video.muted = true;
          setIsMuted(true);
          video.play().catch(() => {});
        });
      return;
    }
    const outcome = computeControlsTapOutcome({ isPlaying: true, controlsVisible });
    if (outcome.armAutoHideTimer) {
      bumpControlsVisibility();
    } else {
      setControlsVisible(outcome.nextVisible);
      clearHideTimer();
    }
  };

  const togglePlay = () => {
    if (ytEngineActive && ytPlayerRef.current) {
      const player = ytPlayerRef.current;
      if (!isPlaying) {
        triggerHiddenYtPlay();
      } else {
        player.pauseVideo();
        setIsPlaying(false);
        setControlsVisible(true);
        clearHideTimer();
      }
      return;
    }

    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video
        .play()
        .then(() => {
          setIsPlaying(true);
          bumpControlsVisibility();
        })
        .catch(() => {
          video.muted = true;
          setIsMuted(true);
          video.play().catch(() => {});
        });
    } else {
      video.pause();
      setIsPlaying(false);
      setControlsVisible(true);
      clearHideTimer();
    }
  };

  const isFragmentedStream = (videoEl: HTMLVideoElement): boolean => {
    if (
      activeUrlRef.current.includes('/api/xtream/hls/') ||
      activeUrlRef.current.includes('remux=1')
    ) {
      return true;
    }
    const knownDur = Math.max(durationRef.current, knownDurationSeconds);
    if (
      activeUrlRef.current.startsWith('/api/xtream/stream/') &&
      knownDur > 0 &&
      (!Number.isFinite(videoEl.duration) || videoEl.duration < knownDur * 0.85)
    ) {
      return true;
    }
    return false;
  };

  const seekBy = (deltaSeconds: number) => {
    if (ytEngineActive && ytPlayerRef.current) {
      const player = ytPlayerRef.current;
      const cur = player.getCurrentTime() || currentTime;
      const total = effectiveDuration > 0 ? effectiveDuration : player.getDuration();
      const target = Math.max(0, total > 0 ? Math.min(total, cur + deltaSeconds) : cur + deltaSeconds);
      player.seekTo(target, true);
      setCurrentTime(target);
      setYtEnded(false);
      bumpControlsVisibility();
      return;
    }

    const video = videoRef.current;
    if (!video) return;
    const isNativeSeekable =
      Number.isFinite(video.duration) &&
      video.duration > 0 &&
      !isFragmentedStream(video);

    if (isNativeSeekable) {
      const target = Math.max(0, Math.min(video.duration, video.currentTime + deltaSeconds));
      pendingSeekTargetRef.current = target;
      setPendingSeekTarget(target);
      lastProgressAtRef.current = Date.now();
      setIsBuffering(true);
      video.currentTime = target;
      setCurrentTime(target);
      bumpControlsVisibility();
      return;
    }

    const total = effectiveDuration;
    const baseOffset =
      pendingSeekTargetRef.current !== null
        ? pendingSeekTargetRef.current
        : remuxSeekOffset + video.currentTime;
    const target = Math.max(
      0,
      Math.min(total > 0 ? total - 1 : Infinity, baseOffset + deltaSeconds),
    );
    if (Number.isFinite(target) && seekHandlerRef.current && streamUrl.startsWith('/api/xtream/stream/')) {
      seekHandlerRef.current(target);
      bumpControlsVisibility();
    }
  };

  const commitSeekTarget = useCallback(
    (val: number) => {
      if (!Number.isFinite(val)) return;
      if (keyboardSeekTimerRef.current) {
        window.clearTimeout(keyboardSeekTimerRef.current);
        keyboardSeekTimerRef.current = null;
      }

      if (ytEngineActive && ytPlayerRef.current) {
        ytPlayerRef.current.seekTo(val, true);
        setCurrentTime(val);
        setYtEnded(false);
        bumpControlsVisibility();
        return;
      }

      const video = videoRef.current;
      if (!video) return;
      const isNativeSeekable =
        Number.isFinite(video.duration) &&
        video.duration > 0 &&
        !isFragmentedStream(video);

      if (isNativeSeekable) {
        const clamped = Math.max(0, Math.min(video.duration, val));
        pendingSeekTargetRef.current = clamped;
        setPendingSeekTarget(clamped);
        lastProgressAtRef.current = Date.now();
        setIsBuffering(true);
        video.currentTime = clamped;
        setCurrentTime(clamped);
        bumpControlsVisibility();
        return;
      }

      if (seekHandlerRef.current && streamUrl.startsWith('/api/xtream/stream/')) {
        seekHandlerRef.current(val);
        bumpControlsVisibility();
      }
    },
    [bumpControlsVisibility, streamUrl, ytEngineActive],
  );

  const handleSeekInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    if (!Number.isFinite(val)) return;

    if (Date.now() - lastPointerCommitAtRef.current < 220) {
      return;
    }

    scrubPreviewRef.current = val;
    setScrubPreviewTime(val);
    bumpControlsVisibility();

    if (isPointerScrubbingRef.current) {
      return;
    }

    if (keyboardSeekTimerRef.current) {
      window.clearTimeout(keyboardSeekTimerRef.current);
    }
    keyboardSeekTimerRef.current = window.setTimeout(() => {
      keyboardSeekTimerRef.current = null;
      scrubPreviewRef.current = null;
      setScrubPreviewTime(null);
      commitSeekTarget(val);
    }, 100);
  };

  const handleSeekCommitRelease = () => {
    if (!isPointerScrubbingRef.current) return;
    isPointerScrubbingRef.current = false;
    lastPointerCommitAtRef.current = Date.now();
    const target = scrubPreviewRef.current;
    scrubPreviewRef.current = null;
    setScrubPreviewTime(null);
    if (target !== null) {
      commitSeekTarget(target);
    }
  };

  const toggleMute = () => {
    if (ytEngineActive && ytPlayerRef.current) {
      const player = ytPlayerRef.current;
      const nextMuted = !isMuted;
      if (nextMuted) {
        player.mute();
      } else {
        player.unMute();
        const nextVol = volume === 0 ? 0.8 : volume;
        if (volume === 0) setVolume(0.8);
        player.setVolume(Math.round(nextVol * 100));
      }
      setIsMuted(nextMuted);
      bumpControlsVisibility();
      return;
    }

    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !isMuted;
    video.muted = nextMuted;
    setIsMuted(nextMuted);
    if (!nextMuted && video.volume === 0) {
      video.volume = 0.8;
      setVolume(0.8);
    }
    bumpControlsVisibility();
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVol = Number(e.target.value);
    if (!Number.isFinite(nextVol)) return;

    if (ytEngineActive && ytPlayerRef.current) {
      const player = ytPlayerRef.current;
      if (nextVol === 0) {
        player.mute();
      } else {
        player.unMute();
        player.setVolume(Math.round(nextVol * 100));
      }
      setVolume(nextVol);
      setIsMuted(nextVol === 0);
      bumpControlsVisibility();
      return;
    }

    const video = videoRef.current;
    if (!video) return;
    video.volume = nextVol;
    video.muted = nextVol === 0;
    setVolume(nextVol);
    setIsMuted(nextVol === 0);
    bumpControlsVisibility();
  };

  const cycleSpeed = () => {
    const idx = SPEED_OPTIONS.indexOf(playbackRate);
    const nextRate = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    setPlaybackRate(nextRate);

    if (ytEngineActive && ytPlayerRef.current) {
      try {
        ytPlayerRef.current.setPlaybackRate(nextRate);
      } catch {
        // ignore unsupported speed
      }
      bumpControlsVisibility();
      return;
    }

    const video = videoRef.current;
    if (video) {
      video.playbackRate = nextRate;
    }
    bumpControlsVisibility();
  };

  const toggleFullscreen = async () => {
    const container = containerRef.current;
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!container) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (container.requestFullscreen) {
        await container.requestFullscreen();
      } else if (!ytEngineActive && video?.webkitEnterFullscreen) {
        video.webkitEnterFullscreen();
      }
    } catch {
      if (!ytEngineActive && video?.webkitEnterFullscreen) {
        video.webkitEnterFullscreen();
      }
    }
    bumpControlsVisibility();
  };

  const effectiveDuration =
    Number.isFinite(duration) && duration > 0
      ? duration
      : knownDurationSeconds > 0
        ? knownDurationSeconds
        : 0;
  const displayTime =
    scrubPreviewTime !== null
      ? scrubPreviewTime
      : pendingSeekTarget !== null
        ? pendingSeekTarget
        : remuxSeekOffset + currentTime;
  const progressPct = effectiveDuration > 0 ? Math.min(100, (displayTime / effectiveDuration) * 100) : 0;
  const bufferedPct =
    effectiveDuration > 0
      ? Math.min(100, ((remuxSeekOffset + bufferedEnd) / effectiveDuration) * 100)
      : 0;
  const showControls = controlsVisible || !isPlaying;
  const maskHiddenYt = ytEngineActive && (!ytHasStartedPlayback || ytRevealHold || !isPlaying || ytEnded);

  return (
    <div
      ref={containerRef}
      data-testid="drama-video-player"
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse' && isPlayingRef.current) {
          bumpControlsVisibility();
        }
      }}
      className={`group relative w-full overflow-hidden bg-black select-none ${
        isFullscreen
          ? 'h-screen w-screen rounded-none'
          : theaterMode
            ? 'aspect-video max-h-[78vh] rounded-none border-0 shadow-2xl sm:rounded-2xl sm:border sm:border-slate-800'
            : 'aspect-video rounded-none border-0 sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-lg sm:dark:border-slate-800'
      }`}
    >
      {/* Concealed background YouTube engine: non-interactive, vertically overscanned to slice top/bottom YouTube chrome */}
      {ytEngineActive && (
        <div
          ref={ytHostRef}
          data-testid="yt-hidden-engine"
          aria-hidden="true"
          className={getHiddenYouTubeHostClass(fillScreen)}
        />
      )}

      {/* Static-host embed fallback for Dailymotion videos when running on static hosting (e.g. GitHub Pages) */}
      {dmEmbedActive && !hasError && (
        <iframe
          src={`https://www.dailymotion.com/embed/video/${encodeURIComponent(videoId)}?autoplay=1`}
          title={title}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 z-[8] h-full w-full border-0"
        />
      )}

      {/* Opaque poster/backdrop mask whenever YouTube is loading, starting, paused, or ended */}
      {maskHiddenYt && !hasError && (
        <div
          data-testid="yt-overlay-mask"
          className="pointer-events-none absolute inset-0 z-[5] overflow-hidden bg-black"
        >
          {thumbnail && (
            <img
              src={thumbnail}
              alt=""
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover opacity-40"
            />
          )}
          <div className="absolute inset-0 bg-black/45" />
        </div>
      )}

      {/* Interactive surface catching all taps/clicks above the concealed YouTube frame */}
      {ytEngineActive && !hasError && (
        <div
          data-testid="yt-surface-catcher"
          onClick={handleVideoSurfaceClick}
          className="absolute inset-0 z-[6] cursor-pointer bg-transparent"
        />
      )}

      <video
        ref={videoRef}
        poster={thumbnail || undefined}
        playsInline
        preload="auto"
        onClick={handleVideoSurfaceClick}
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          if (Number.isFinite(el.duration) && el.duration > 0 && !isFragmentedStream(el)) {
            setDuration(el.duration);
          }
          setIsBuffering(false);
        }}
        onSeeked={(e) => {
          const el = e.currentTarget;
          lastProgressAtRef.current = Date.now();
          setIsBuffering(false);
          if (pendingSeekTargetRef.current !== null) {
            const absPos = remuxSeekOffsetRef.current + el.currentTime;
            if (Math.abs(absPos - pendingSeekTargetRef.current) <= 3) {
              pendingSeekTargetRef.current = null;
              setPendingSeekTarget(null);
              setCurrentTime(el.currentTime);
            }
          }
        }}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          lastProgressAtRef.current = Date.now();
          if (stallWatchdogRef.current && el.currentTime > 0.2) {
            window.clearTimeout(stallWatchdogRef.current);
            stallWatchdogRef.current = null;
          }
          if (pendingSeekTargetRef.current !== null) {
            const absPos = remuxSeekOffsetRef.current + el.currentTime;
            if (
              Math.abs(absPos - pendingSeekTargetRef.current) <= 3 ||
              (remuxSeekOffsetRef.current === pendingSeekTargetRef.current && el.currentTime > 0.05)
            ) {
              pendingSeekTargetRef.current = null;
              setPendingSeekTarget(null);
            }
          }
          setCurrentTime(el.currentTime);
          if (Number.isFinite(el.duration) && el.duration > 0 && !isFragmentedStream(el)) {
            setDuration(el.duration);
          }
          if (el.buffered.length > 0) {
            setBufferedEnd(el.buffered.end(el.buffered.length - 1));
          }
        }}
        onWaiting={(e) => {
          const el = e.currentTarget;
          setIsBuffering(true);
          if (
            activeUrlRef.current.startsWith('/api/xtream/stream/') &&
            !/(?:[?&])low=(?:1|true)\b/.test(activeUrlRef.current) &&
            !el.paused &&
            !isPointerScrubbingRef.current &&
            !stallWatchdogRef.current
          ) {
            const stallDetectedAt = Date.now();
            stallWatchdogRef.current = window.setTimeout(() => {
              stallWatchdogRef.current = null;
              if (
                !el.paused &&
                !isPointerScrubbingRef.current &&
                (el.readyState < 2 || lastProgressAtRef.current < stallDetectedAt)
              ) {
                adaptiveSwitchHandlerRef.current?.();
              }
            }, 8500);
          }
        }}
        onPlaying={(e) => {
          const el = e.currentTarget;
          xtreamRecoveryStepRef.current = 0;
          if (startupWatchdogRef.current) {
            window.clearTimeout(startupWatchdogRef.current);
            startupWatchdogRef.current = null;
          }
          if (stallWatchdogRef.current) {
            window.clearTimeout(stallWatchdogRef.current);
            stallWatchdogRef.current = null;
          }
          lastProgressAtRef.current = Date.now();
          if (pendingSeekTargetRef.current !== null && remuxSeekOffsetRef.current > 0 && el.currentTime >= 0) {
            pendingSeekTargetRef.current = null;
            setPendingSeekTarget(null);
          }
          setHasError(false);
          setIsBuffering(false);
          setIsPlaying(true);
          onStreamRecoveredRef.current?.();
        }}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setControlsVisible(true);
          clearHideTimer();
        }}
        onError={() => {
          if (ytEngineActiveRef.current) return;
          if (fallbackHandlerRef.current?.()) {
            return;
          }
          const msg = errorDetail || t.streamAccessErrorLabel;
          setHasError(true);
          setIsBuffering(false);
          onStreamErrorRef.current?.({ status: errorStatus, message: msg });
        }}
        className={`h-full w-full cursor-pointer transition-all duration-200 ${
          ytEngineActive || dmEmbedActive ? 'hidden' : ''
        } ${fillScreen ? 'object-cover' : 'object-contain'}`}
      />

      {/* Buffering indicator */}
      {isBuffering && !dmEmbedActive && !hasError && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/25">
          <div className="h-12 w-12 animate-spin rounded-full border-3 border-white/25 border-t-red-600" />
        </div>
      )}

      {/* Stream Error Overlay (no retry buttons) */}
      {hasError && (
        <div
          data-testid="player-error-overlay"
          className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 overflow-y-auto bg-black/95 px-3 py-2.5 text-center text-white sm:gap-3 sm:px-6 sm:py-4"
        >
          <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-600/20 text-red-400 sm:flex">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <p className="max-w-md text-xs font-semibold text-slate-200 sm:text-sm">
            {errorDetail || t.errorTitle}
          </p>

          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-white/15 px-4 text-xs font-semibold text-white transition-colors hover:bg-white/25"
            >
              <BackArrow className="h-4 w-4" />
              <span>{t.backToList}</span>
            </button>
          )}
        </div>
      )}

      {/* Center Play Button when paused */}
      {!isPlaying && !isBuffering && !dmEmbedActive && !hasError && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label={t.playerPlay}
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/25 transition-colors hover:bg-black/35"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-2xl transition-transform hover:scale-105">
            <Play className="h-7 w-7 fill-white ms-0.5" />
          </span>
        </button>
      )}

      {/* Top Overlay: Back button + Title — auto-hides & toggles instantaneously with bottom controls */}
      {!hasError && !dmEmbedActive && (
        <div
          data-testid="player-top-bar"
          className={`pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-2.5 bg-gradient-to-b from-black/90 via-black/55 to-transparent px-3 pt-3 pb-10 transition-opacity duration-75 sm:px-4 ${
            showControls ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {onBack && (
            <button
              type="button"
              onClick={() => {
                if (document.fullscreenElement) {
                  void document.exitFullscreen().catch(() => {});
                }
                onBack();
              }}
              aria-label={t.backToList}
              data-testid="player-back-button"
              className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/80 ${
                showControls ? 'pointer-events-auto' : 'pointer-events-none'
              }`}
            >
              <BackArrow className="h-5 w-5" />
            </button>
          )}
          <p className="pointer-events-none min-w-0 flex-1 truncate text-xs font-semibold text-white drop-shadow sm:text-sm">
            {title}
          </p>
        </div>
      )}

      {/* Bottom Controls Bar */}
      {!hasError && !dmEmbedActive && (
        <div
          data-testid="player-controls-bar"
          className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/95 via-black/75 to-transparent px-2 pt-8 pb-2 text-white transition-opacity duration-75 sm:px-4 sm:pt-10 sm:pb-3 ${
            showControls ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {/* Scrubbable Progress Slider */}
          <div dir="ltr" className={`relative mb-1 flex h-5 items-center sm:mb-2 ${showControls ? 'pointer-events-auto' : 'pointer-events-none'}`}>
            {scrubPreviewTime !== null && (
              <div
                className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded-md bg-black/90 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white shadow ring-1 ring-white/15"
                style={{ left: `${Math.min(94, Math.max(6, progressPct))}%` }}
              >
                {formatVideoDuration(scrubPreviewTime)}
              </div>
            )}
            <div className="pointer-events-none relative h-1.5 w-full overflow-hidden rounded-full bg-white/25">
              <div
                className="absolute inset-y-0 left-0 bg-white/35"
                style={{ width: `${bufferedPct}%` }}
              />
              <div
                data-testid="player-progress-fill"
                className="absolute inset-y-0 left-0 bg-red-600"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <input
              type="range"
              data-testid="player-seek-slider"
              min={0}
              max={effectiveDuration || 100}
              step={0.5}
              value={Math.min(displayTime, effectiveDuration || 100)}
              onPointerDown={() => {
                isPointerScrubbingRef.current = true;
                scrubPreviewRef.current = displayTime;
                setScrubPreviewTime(displayTime);
              }}
              onTouchStart={() => {
                isPointerScrubbingRef.current = true;
                scrubPreviewRef.current = displayTime;
                setScrubPreviewTime(displayTime);
              }}
              onChange={handleSeekInput}
              onPointerUp={handleSeekCommitRelease}
              onPointerCancel={handleSeekCommitRelease}
              onTouchEnd={handleSeekCommitRelease}
              onBlur={handleSeekCommitRelease}
              aria-label={title}
              dir="ltr"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </div>

          {/* Control Buttons Row */}
          <div className={`flex w-full min-w-0 items-center justify-between gap-1 sm:gap-2 ${showControls ? 'pointer-events-auto' : 'pointer-events-none'}`}>
            <div className="flex min-w-0 items-center gap-0.5 sm:gap-1.5">
              <button
                type="button"
                onClick={togglePlay}
                aria-label={isPlaying ? t.playerPause : t.playerPlay}
                data-testid="player-play-toggle"
                className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/15 min-[375px]:w-8 sm:h-9 sm:w-9"
              >
                {isPlaying ? <Pause className="h-4 w-4 fill-white" /> : <Play className="h-4 w-4 fill-white" />}
              </button>

              <button
                type="button"
                onClick={() => seekBy(-10)}
                aria-label={t.playerSeekBack}
                className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/15 min-[375px]:w-8 sm:h-9 sm:w-9"
              >
                <RotateCcw className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => seekBy(10)}
                aria-label={t.playerSeekForward}
                className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/15 min-[375px]:w-8 sm:h-9 sm:w-9"
              >
                <RotateCw className="h-4 w-4" />
              </button>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-label={isMuted ? t.playerUnmute : t.playerMute}
                  className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/15 min-[375px]:w-8 sm:h-9 sm:w-9"
                >
                  {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  aria-label={t.playerMute}
                  dir="ltr"
                  className="hidden h-1 w-16 cursor-pointer accent-red-600 sm:block"
                />
              </div>

              <span dir="ltr" className="ms-0.5 min-w-0 truncate whitespace-nowrap tabular-nums text-[10.5px] font-medium text-white/95 sm:ms-1 sm:text-xs">
                {formatVideoDuration(displayTime)} / {formatVideoDuration(effectiveDuration)}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-0.5 sm:gap-1.5">
              <button
                type="button"
                onClick={cycleSpeed}
                aria-label={t.playerSpeed}
                className="inline-flex h-7 min-w-[28px] shrink-0 items-center justify-center rounded-lg bg-white/10 px-1.5 tabular-nums text-[11px] font-semibold text-white transition-colors hover:bg-white/20 sm:h-8 sm:px-2 sm:text-xs"
              >
                {playbackRate}x
              </button>

              <button
                type="button"
                onClick={() => {
                  setFillScreen((v) => !v);
                  bumpControlsVisibility();
                }}
                aria-label={fillScreen ? t.playerFitScreen : t.playerFillScreen}
                title={fillScreen ? t.playerFitScreen : t.playerFillScreen}
                data-testid="player-stretch-button"
                className={`inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-lg transition-colors min-[375px]:w-8 sm:h-9 sm:w-9 ${
                  fillScreen ? 'bg-red-600 text-white' : 'text-white hover:bg-white/15'
                }`}
              >
                <MoveHorizontal className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={onToggleTheater}
                aria-label={theaterMode ? t.playerDefaultView : t.playerTheater}
                title={theaterMode ? t.playerDefaultView : t.playerTheater}
                className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/15 xl:inline-flex"
              >
                <RectangleHorizontal className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => void toggleFullscreen()}
                aria-label={isFullscreen ? t.playerExitFullscreen : t.playerFullscreen}
                title={isFullscreen ? t.playerExitFullscreen : t.playerFullscreen}
                data-testid="player-fullscreen-button"
                className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/15 min-[375px]:w-8 sm:h-9 sm:w-9"
              >
                {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
