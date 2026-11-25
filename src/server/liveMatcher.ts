export interface LiveChannelEntry {
  name: string;
  url: string;
  logo?: string;
}

export interface KnownLiveStreamEntry {
  id: string;
  patterns: RegExp[];
  preferredUrl: string;
  label: string;
  titleAr: string;
}

const KNOWN_ARABIC_LIVE_STREAMS: KnownLiveStreamEntry[] = [
  {
    id: 'live_mbc_iraq',
    label: 'MBC Iraq',
    titleAr: 'البث المباشر لقناة MBC العراق',
    patterns: [/\bmbc\s*iraq\b/i, /ام\s*بي\s*سي\s*العراق/i, /mbc\s*العراق/i],
    preferredUrl:
      'https://shd-gcp-live.edgenextcdn.net/live/bitmovin-mbc-iraq/e38c44b1b43474e1c39cb5b90203691e/index.m3u8',
  },
  {
    id: 'live_al_sharqiya_news',
    label: 'Al Sharqiya News',
    titleAr: 'البث المباشر لقناة الشرقية نيوز',
    patterns: [/الشرقية\s*نيوز/i, /al\s*sharqiya\s*news/i, /sharqiya\s*news/i],
    preferredUrl: 'https://indexforce.com/newshighres/mystream/playlist.m3u8',
  },
  {
    id: 'live_al_sharqiya',
    label: 'Al Sharqiya',
    titleAr: 'البث المباشر لقناة الشرقية',
    patterns: [/الشرقية/i, /al\s*sharqiya/i, /alsharqiya/i],
    preferredUrl: 'http://185.9.2.18/chid_144/index.m3u8',
  },
  {
    id: 'live_dijlah',
    label: 'Dijlah TV',
    titleAr: 'البث المباشر لقناة دجلة الفضائية',
    patterns: [/قناة\s*دجلة/i, /دجلة/i, /\bdijlah\b/i],
    preferredUrl: 'https://ghaasiflu.online/Dijlah/index.m3u8',
  },
  {
    id: 'live_al_iraqia_news',
    label: 'Al Iraqia News',
    titleAr: 'البث المباشر لقناة العراقية الإخبارية',
    patterns: [/العراقية\s*الاخبارية/i, /العراقية\s*الإخبارية/i, /al\s*iraqia\s*news/i],
    preferredUrl: 'https://imn-live.esite-lab.com/hls/iraqia-news.m3u8',
  },
  {
    id: 'live_al_iraqia',
    label: 'Al Iraqia',
    titleAr: 'البث المباشر لقناة العراقية العامة',
    patterns: [/قناة\s*العراقية/i, /العراقية/i, /\bal\s*iraqia\b/i],
    preferredUrl: 'https://imn-live.esite-lab.com/hls/iraqia-general.m3u8',
  },
  {
    id: 'live_al_hadath',
    label: 'Al Hadath',
    titleAr: 'البث المباشر لقناة الحدث AlHadath',
    patterns: [/قناة\s*الحدث/i, /الحدث/i, /\bal\s*hadath\b/i, /\balhadath\b/i],
    preferredUrl:
      'https://shd-gcp-live.edgenextcdn.net/live/bitmovin-hadath/2ff87ec4c2f3ede35295a20637d9f8fd/index.m3u8',
  },
  {
    id: 'live_al_arabiya',
    label: 'Al Arabiya',
    titleAr: 'البث المباشر لقناة العربية AlArabiya',
    patterns: [/قناة\s*العربية/i, /العربية/i, /\bal\s*arabiya\b/i, /\balarabiya\b/i],
    preferredUrl: 'https://live.alarabiya.net/alarabiapublish/aaprograms.smil/playlist.m3u8',
  },
  {
    id: 'live_al_jazeera',
    label: 'Al Jazeera',
    titleAr: 'البث المباشر لقناة الجزيرة',
    patterns: [/قناة\s*الجزيرة/i, /الجزيرة/i, /\bal\s*jazeera\b/i, /\baljazeera\b/i],
    preferredUrl: 'https://live-hls-apps-aja-fa.getaj.net/AJA/01.m3u8',
  },
  {
    id: 'live_al_rasheed',
    label: 'Al Rasheed TV',
    titleAr: 'البث المباشر لقناة الرشيد',
    patterns: [/قناة\s*الرشيد/i, /الرشيد/i, /\bal\s*rasheed\b/i],
    preferredUrl: 'https://media1.livaat.com/static/AL-RASHEED-HD/playlist.m3u8',
  },
  {
    id: 'live_afaq',
    label: 'Afaq TV',
    titleAr: 'البث المباشر لقناة آفاق',
    patterns: [/قناة\s*آفاق/i, /قناة\s*افاق/i, /\bafaq\b/i],
    preferredUrl: 'https://stream.afaq.iq/live/channel/afaqtv/playlist.m3u8',
  },
  {
    id: 'live_sky_news_arabia',
    label: 'Sky News Arabia',
    titleAr: 'البث المباشر لقناة سكاي نيوز عربية',
    patterns: [/سكاي\s*نيوز\s*عربية/i, /سكاي\s*نيوز/i, /\bsky\s*news\s*arabia\b/i],
    preferredUrl:
      'https://live-stream.skynewsarabia.com/c-horizontal-channel/horizontal-stream/index.m3u8',
  },
  {
    id: 'live_altaghier',
    label: 'Altaghier TV',
    titleAr: 'البث المباشر لقناة التغيير',
    patterns: [/قناة\s*التغيير/i, /التغيير/i, /\baltaghier\b/i],
    preferredUrl: 'https://jmc-live.ercdn.net/altaghier/altaghier.m3u8',
  },
  {
    id: 'live_al_ghad',
    label: 'Al Ghad TV',
    titleAr: 'البث المباشر لقناة الغد',
    patterns: [/قناة\s*الغد/i, /الغد\s*مباشر/i, /\bal\s*ghad\b/i, /\balghad\b/i],
    preferredUrl: 'https://eazyvwqssi.erbvr.com/alghadtv/alghadtv.m3u8',
  },
  {
    id: 'live_france_24_arabic',
    label: 'France 24 Arabic',
    titleAr: 'البث المباشر لقناة فرانس 24',
    patterns: [/فرانس\s*24/i, /\bfrance\s*24\b/i],
    preferredUrl: 'https://live.france24.com/hls/live/2037222-b/F24_AR_HI_HLS/master_5000.m3u8',
  },
  {
    id: 'live_dw_arabic',
    label: 'DW Arabic',
    titleAr: 'البث المباشر لقناة DW عربية',
    patterns: [/dw\s*عربية/i, /دويتشه\s*فيله/i, /\bdw\s*arabic\b/i],
    preferredUrl: 'https://dwamdstream103.akamaized.net/hls/live/2015526/dwstream103/master.m3u8',
  },
];

export function listKnownLiveChannels(dynamicEntries: LiveChannelEntry[] = []): Array<{
  id: string;
  label: string;
  titleAr: string;
  url: string;
  logo?: string;
}> {
  return KNOWN_ARABIC_LIVE_STREAMS.map((known) => {
    const dynamicMatch = dynamicEntries.find((e) =>
      known.patterns.some((re) => re.test(e.name)),
    );
    return {
      id: known.id,
      label: known.label,
      titleAr: known.titleAr,
      url: dynamicMatch?.url || known.preferredUrl,
      logo: dynamicMatch?.logo,
    };
  });
}

export function getLiveChannelById(
  id: string,
  dynamicEntries: LiveChannelEntry[] = [],
): { id: string; label: string; titleAr: string; url: string; logo?: string } | null {
  const known = KNOWN_ARABIC_LIVE_STREAMS.find((k) => k.id === id);
  if (!known) return null;
  const dynamicMatch = dynamicEntries.find((e) =>
    known.patterns.some((re) => re.test(e.name)),
  );
  return {
    id: known.id,
    label: known.label,
    titleAr: known.titleAr,
    url: dynamicMatch?.url || known.preferredUrl,
    logo: dynamicMatch?.logo,
  };
}

export function parseM3uLivePlaylist(m3uText: string): LiveChannelEntry[] {
  const lines = m3uText.split(/\r?\n/);
  const entries: LiveChannelEntry[] = [];
  let pendingName = '';
  let pendingLogo = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF')) {
      const commaIdx = line.lastIndexOf(',');
      pendingName = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : '';
      const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
      pendingLogo = logoMatch?.[1] || '';
      continue;
    }

    if (line.startsWith('#')) continue;

    if (/^https?:\/\/.+\.m3u8/i.test(line) && pendingName) {
      entries.push({
        name: pendingName.replace(/\s*\([^)]*\)\s*/g, ' ').trim(),
        url: line,
        logo: pendingLogo || undefined,
      });
    }
    pendingName = '';
    pendingLogo = '';
  }

  return entries;
}

const LIVE_INDICATOR_PATTERN = /(بث\s*مباشر|مباشر|بث\s*حي|\blive\s*stream\b|\blive\s*tv\b|\blive\b)/i;

export function matchLiveBroadcastStream(
  title: string,
  channelName: string,
  isLive: boolean,
  dynamicEntries: LiveChannelEntry[] = [],
): { id: string; url: string; label: string; titleAr: string } | null {
  const combined = `${title} ${channelName}`.trim();
  if (!combined) return null;

  const looksLive = Boolean(isLive || LIVE_INDICATOR_PATTERN.test(combined));
  if (!looksLive) return null;

  for (const known of KNOWN_ARABIC_LIVE_STREAMS) {
    if (known.patterns.some((re) => re.test(combined))) {
      const dynamicMatch = dynamicEntries.find((e) =>
        known.patterns.some((re) => re.test(e.name)),
      );
      return {
        id: known.id,
        url: dynamicMatch?.url || known.preferredUrl,
        label: known.label,
        titleAr: known.titleAr,
      };
    }
  }

  if (dynamicEntries.length > 0) {
    const cleanChannel = channelName
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .trim();
    if (cleanChannel.length >= 3) {
      const matched = dynamicEntries.find((e) => {
        const ename = e.name.toLowerCase();
        return ename.includes(cleanChannel) || cleanChannel.includes(ename);
      });
      if (matched) {
        return {
          id: `live_${cleanChannel.replace(/\s+/g, '_').slice(0, 24)}`,
          url: matched.url,
          label: matched.name,
          titleAr: matched.name,
        };
      }
    }
  }

  return null;
}

export function findMatchingLiveBroadcasts(
  query: string,
  dynamicEntries: LiveChannelEntry[] = [],
  limit = 6,
): Array<{ id: string; url: string; label: string; titleAr: string; logo?: string }> {
  const clean = query.trim();
  if (!clean) return [];

  const results: Array<{ id: string; url: string; label: string; titleAr: string; logo?: string }> = [];
  const seenLabels = new Set<string>();

  for (const known of KNOWN_ARABIC_LIVE_STREAMS) {
    if (known.patterns.some((re) => re.test(clean))) {
      const dynamicMatch = dynamicEntries.find((e) =>
        known.patterns.some((re) => re.test(e.name)),
      );
      if (!seenLabels.has(known.label)) {
        seenLabels.add(known.label);
        results.push({
          id: known.id,
          url: dynamicMatch?.url || known.preferredUrl,
          label: known.label,
          titleAr: known.titleAr,
          logo: dynamicMatch?.logo,
        });
        if (results.length >= limit) return results;
      }
    }
  }

  return results;
}
