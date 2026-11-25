export type SortOrder = 'relevance' | 'date' | 'views' | 'rating';
export type SearchType = 'all' | 'video' | 'live' | 'short';
export type DurationFilter = 'any' | 'short' | 'medium' | 'long';
export type TrendingCategory = 'all' | 'tech' | 'music' | 'gaming' | 'education' | 'news';
export type TikTokCategory = 'all' | 'comedy' | 'gaming' | 'sports' | 'music' | 'food';
export type AppLocale = 'ar' | 'en';

export interface MediaVideo {
  id: string;
  title: string;
  channelName: string;
  channelId: string;
  channelAvatar?: string;
  channelVerified?: boolean;
  thumbnail: string;
  duration: string;
  durationSeconds: number;
  isLive: boolean;
  isShort: boolean;
  viewsText: string;
  viewsCount: number | null;
  publishedText: string;
  descriptionSnippet?: string;
  streamUrl: string;
  sourceType?: 'video' | 'tiktok';
}

export interface TikTokReel {
  id: string;
  caption: string;
  authorName: string;
  authorHandle: string;
  authorAvatar?: string;
  authorVerified: boolean;
  coverUrl: string;
  streamUrl: string;
  durationSeconds: number;
  duration: string;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  viewsCount: number;
  musicTitle?: string;
  musicAuthor?: string;
  category: TikTokCategory;
}

export interface TikTokFeedResponse {
  category: TikTokCategory;
  items: TikTokReel[];
  hasMore: boolean;
  source: 'tiktok-server' | 'custom-tiktok-server';
}

export interface MediaChannelSummary {
  id: string;
  name: string;
  handle?: string;
  avatar?: string;
  subscribersText?: string;
  verified?: boolean;
  description?: string;
  videoCountText?: string;
}

export interface SearchResponse {
  query: string;
  sort: SortOrder;
  type: SearchType;
  duration: DurationFilter;
  estimatedResults: number;
  items: MediaVideo[];
  channels: MediaChannelSummary[];
  continuation: string | null;
  source: 'media-server';
  hl: string;
}

export interface SubscribedChannel {
  id: string;
  name: string;
  avatar?: string;
  subscribersText?: string;
  subscribedAt: number;
}

export interface DownloadedVideo extends MediaVideo {
  downloadedAt: number;
  sizeBytes?: number;
  offlineReady?: boolean;
}

export interface MediaComment {
  id: string;
  authorName: string;
  authorAvatar?: string;
  text: string;
  publishedText: string;
  likesText: string;
  replyCountText?: string;
  isCreator?: boolean;
}

export interface VideoDetailsResponse {
  video: MediaVideo & {
    description: string;
    subscribersText: string;
    likesText?: string;
    uploadDateText?: string;
  };
  related: MediaVideo[];
  comments?: MediaComment[];
  source: 'media-server';
}

export interface SuggestResponse {
  query: string;
  suggestions: string[];
  source: 'media-suggest';
}

export interface TrendingResponse {
  category: TrendingCategory;
  items: MediaVideo[];
  source: 'media-server';
  hl: string;
}

export interface ChannelResponse {
  channel: MediaChannelSummary & {
    banner?: string;
  };
  videos: MediaVideo[];
  source: 'media-server';
}

export interface ServerHealthResponse {
  status: 'ok';
  service: string;
  uptimeSeconds: number;
  cacheEntries: number;
}

export type XtreamTab = 'series' | 'movies';
export type XtreamServerId = '1' | '2';

export interface XtreamCategory {
  id: string;
  name: string;
}

export interface XtreamSeriesItem {
  id: string;
  name: string;
  cover: string;
  rating?: string;
  plot?: string;
  genre?: string;
  categoryId: string;
  releaseDate?: string;
  cast?: string;
  director?: string;
}

export interface XtreamEpisode {
  id: string;
  episodeNum: number;
  seasonNum: number;
  title: string;
  duration?: string;
  durationSeconds?: number;
  streamUrl: string;
  containerExtension: string;
  thumbnail?: string;
  plot?: string;
}

export interface XtreamSeasonGroup {
  seasonNumber: number;
  episodes: XtreamEpisode[];
}

export interface XtreamSeriesDetails {
  series: XtreamSeriesItem & {
    backdrop?: string;
  };
  seasons: XtreamSeasonGroup[];
  configured: boolean;
}

export interface XtreamMovieItem {
  id: string;
  name: string;
  cover: string;
  rating?: string;
  categoryId: string;
  containerExtension: string;
  addedAt?: string;
  streamUrl: string;
  duration?: string;
  durationSeconds?: number;
  plot?: string;
  genre?: string;
}

export interface XtreamCatalogResponse {
  serverId?: XtreamServerId;
  tab: XtreamTab;
  categoryId: string;
  query: string;
  categories: XtreamCategory[];
  series: XtreamSeriesItem[];
  movies: XtreamMovieItem[];
  total: number;
  hasMore: boolean;
  configured: boolean;
}


