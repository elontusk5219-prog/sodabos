"use client";
import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

interface Token {
  id: number;
  label: string;
  token_preview: string;
  status: string;
  fail_reason: string;
}
interface Handle {
  handle: string;
  label: string;
  enabled: boolean;
}
interface Tweet {
  tweet_id: string;
  text: string;
  url: string;
  author: string;
  author_name: string;
  author_avatar: string;
  author_followers: number;
  created_at: string;
  favorites: number;
  retweets: number;
  replies: number;
  views: string;
  bookmarks: number;
  is_retweet: boolean;
  quoted_text: string;
  quoted_author: string;
  has_media: boolean;
  monitor_handle: string;
}
interface Status {
  tokens_total: number;
  tokens_active: number;
  tokens_exhausted: number;
  tokens_error: number;
  handles_total: number;
  handles_enabled: number;
  cached_tweets: number;
  last_fetch_at: string;
  is_fetching: boolean;
}

function formatNum(n: number | string): string {
  const num = typeof n === "string" ? parseInt(n) || 0 : n;
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return num.toString();
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

export default function TwitterMonitor() {
  const [tab, setTab] = useState<"feed" | "tokens" | "handles">("feed");
  const [status, setStatus] = useState<Status | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [handles, setHandles] = useState<Handle[]>([]);
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");
  const [excludeRT, setExcludeRT] = useState(false);
  const [filterHandle, setFilterHandle] = useState("");

  // Forms
  const [newToken, setNewToken] = useState("");
  const [newTokenLabel, setNewTokenLabel] = useState("");
  const [newHandle, setNewHandle] = useState("");
  const [newHandleLabel, setNewHandleLabel] = useState("");

  const loadAll = useCallback(async () => {
    try {
      const [s, t, h, r] = await Promise.all([
        api.twitterStatus(),
        api.twitterTokens(),
        api.twitterHandles(),
        api.twitterResults({ limit: "200", exclude_rt: excludeRT ? "true" : "false" }),
      ]);
      setStatus(s);
      setTokens(t);
      setHandles(h);
      setTweets(r.tweets || []);
    } catch (e: any) {
      setError(e.message);
    }
  }, [excludeRT]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleFetch = async () => {
    setFetching(true);
    setError("");
    try {
      const res = await api.twitterFetch({ max_posts: 30 });
      if (res.error) {
        setError(res.error);
      }
      await loadAll();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setFetching(false);
    }
  };

  const handleAddToken = async () => {
    if (!newToken.trim()) return;
    const res = await api.twitterAddToken(newToken.trim(), newTokenLabel.trim() || undefined);
    if (res.error) setError(res.error);
    setNewToken("");
    setNewTokenLabel("");
    await loadAll();
  };

  const handleAddHandle = async () => {
    if (!newHandle.trim()) return;
    const res = await api.twitterAddHandle(newHandle.trim(), newHandleLabel.trim() || undefined);
    if (res.error) setError(res.error);
    setNewHandle("");
    setNewHandleLabel("");
    await loadAll();
  };

  const filteredTweets = filterHandle
    ? tweets.filter((t) => t.monitor_handle === filterHandle)
    : tweets;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            <span className="mr-2">𝕏</span>Twitter Monitor
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Apify Token 自动轮换 | 多用户实时监控
          </p>
        </div>
        <button
          onClick={handleFetch}
          disabled={fetching}
          className="px-5 py-2.5 bg-black text-white rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {fetching ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Fetching...
            </span>
          ) : (
            "Fetch Now"
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center justify-between">
          <span className="text-sm">{error}</span>
          <button onClick={() => setError("")} className="text-red-400 hover:text-red-600">x</button>
        </div>
      )}

      {/* Status Cards */}
      {status && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-green-600">{status.tokens_active}</div>
            <div className="text-xs text-gray-500">Active Tokens</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-orange-500">{status.tokens_exhausted + status.tokens_error}</div>
            <div className="text-xs text-gray-500">Failed Tokens</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-blue-600">{status.handles_enabled}</div>
            <div className="text-xs text-gray-500">Monitoring</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-gray-900">{status.cached_tweets}</div>
            <div className="text-xs text-gray-500">Cached Tweets</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-sm font-medium text-gray-700">{status.last_fetch_at ? timeAgo(status.last_fetch_at) : "Never"}</div>
            <div className="text-xs text-gray-500">Last Fetch</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-6">
          {[
            { key: "feed", label: "Timeline", count: filteredTweets.length },
            { key: "tokens", label: "Token Pool", count: tokens.length },
            { key: "handles", label: "Handles", count: handles.length },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as any)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? "border-black text-black"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t.label}
              <span className="ml-1.5 px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                {t.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab: Feed */}
      {tab === "feed" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-3">
            <select
              value={filterHandle}
              onChange={(e) => setFilterHandle(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">All Handles</option>
              {handles.map((h) => (
                <option key={h.handle} value={h.handle}>@{h.handle} {h.label !== h.handle ? `(${h.label})` : ""}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={excludeRT}
                onChange={(e) => setExcludeRT(e.target.checked)}
                className="rounded"
              />
              Hide Retweets
            </label>
            <span className="text-xs text-gray-400 ml-auto">
              {filteredTweets.length} tweets
            </span>
          </div>

          {filteredTweets.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <div className="text-4xl mb-4">𝕏</div>
              <p>No tweets yet. Add handles and tokens, then click Fetch Now.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTweets.map((tweet) => (
                <div
                  key={tweet.tweet_id}
                  className={`bg-white border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow ${
                    tweet.is_retweet ? "border-l-4 border-l-gray-300" : ""
                  }`}
                >
                  {/* Author Row */}
                  <div className="flex items-center gap-3 mb-2">
                    {tweet.author_avatar ? (
                      <img
                        src={tweet.author_avatar}
                        alt={tweet.author}
                        className="w-10 h-10 rounded-full"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-500">
                        {tweet.author.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-gray-900 truncate">
                          {tweet.author_name || tweet.author}
                        </span>
                        <span className="text-xs text-gray-400">@{tweet.author}</span>
                        {tweet.is_retweet && (
                          <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">RT</span>
                        )}
                        {tweet.has_media && (
                          <span className="text-xs bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded">Media</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400">
                        {timeAgo(tweet.created_at)}
                        {tweet.author_followers > 0 && (
                          <span className="ml-2">{formatNum(tweet.author_followers)} followers</span>
                        )}
                      </div>
                    </div>
                    <a
                      href={tweet.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-400 hover:text-black text-sm shrink-0"
                    >
                      Open
                    </a>
                  </div>

                  {/* Tweet Text */}
                  <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                    {tweet.text}
                  </p>

                  {/* Quoted Tweet */}
                  {tweet.quoted_text && (
                    <div className="mt-3 border border-gray-100 rounded-lg p-3 bg-gray-50">
                      <div className="text-xs text-gray-500 mb-1">
                        Quoting @{tweet.quoted_author}
                      </div>
                      <p className="text-xs text-gray-700 line-clamp-3">
                        {tweet.quoted_text}
                      </p>
                    </div>
                  )}

                  {/* Metrics */}
                  <div className="flex items-center gap-5 mt-3 text-xs text-gray-400">
                    <span title="Views">{formatNum(tweet.views)} views</span>
                    <span title="Likes">{formatNum(tweet.favorites)} likes</span>
                    <span title="Retweets">{formatNum(tweet.retweets)} RTs</span>
                    <span title="Replies">{formatNum(tweet.replies)} replies</span>
                    <span title="Bookmarks">{formatNum(tweet.bookmarks)} saves</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Tokens */}
      {tab === "tokens" && (
        <div className="space-y-4">
          {/* Add Token Form */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="font-medium text-sm text-gray-700 mb-3">Add Apify Token</h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={newTokenLabel}
                onChange={(e) => setNewTokenLabel(e.target.value)}
                placeholder="Label (optional)"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-36"
              />
              <input
                type="text"
                value={newToken}
                onChange={(e) => setNewToken(e.target.value)}
                placeholder="apify_api_xxxxxxxxx"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 font-mono"
              />
              <button
                onClick={handleAddToken}
                disabled={!newToken.trim()}
                className="px-4 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-30"
              >
                Add
              </button>
            </div>
          </div>

          {/* Token List */}
          {tokens.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p>No tokens added yet. Add your Apify API tokens above.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tokens.map((token) => (
                <div
                  key={token.id}
                  className="bg-white border border-gray-200 rounded-lg p-4 flex items-center gap-4"
                >
                  <div
                    className={`w-3 h-3 rounded-full shrink-0 ${
                      token.status === "active"
                        ? "bg-green-400"
                        : token.status === "exhausted"
                        ? "bg-orange-400"
                        : "bg-red-400"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{token.label}</span>
                      <code className="text-xs text-gray-400 font-mono">{token.token_preview}</code>
                    </div>
                    {token.fail_reason && (
                      <div className="text-xs text-red-500 mt-1 truncate">{token.fail_reason}</div>
                    )}
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      token.status === "active"
                        ? "bg-green-50 text-green-600"
                        : token.status === "exhausted"
                        ? "bg-orange-50 text-orange-600"
                        : "bg-red-50 text-red-600"
                    }`}
                  >
                    {token.status}
                  </span>
                  {token.status !== "active" && (
                    <button
                      onClick={async () => { await api.twitterResetToken(token.id); await loadAll(); }}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      Reset
                    </button>
                  )}
                  <button
                    onClick={async () => { await api.twitterRemoveToken(token.id); await loadAll(); }}
                    className="text-xs text-red-400 hover:text-red-600"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Handles */}
      {tab === "handles" && (
        <div className="space-y-4">
          {/* Add Handle Form */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="font-medium text-sm text-gray-700 mb-3">Add Monitor Target</h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={newHandleLabel}
                onChange={(e) => setNewHandleLabel(e.target.value)}
                placeholder="Label (optional)"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-36"
              />
              <input
                type="text"
                value={newHandle}
                onChange={(e) => setNewHandle(e.target.value)}
                placeholder="@elonmusk"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1"
                onKeyDown={(e) => e.key === "Enter" && handleAddHandle()}
              />
              <button
                onClick={handleAddHandle}
                disabled={!newHandle.trim()}
                className="px-4 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-30"
              >
                Add
              </button>
            </div>
          </div>

          {/* Handle List */}
          {handles.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p>No handles added. Add Twitter usernames to monitor above.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {handles.map((h) => (
                <div
                  key={h.handle}
                  className={`bg-white border rounded-lg p-4 flex items-center gap-4 transition-colors ${
                    h.enabled ? "border-gray-200" : "border-gray-100 opacity-50"
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-black text-white flex items-center justify-center text-sm font-bold">
                    {h.handle.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">@{h.handle}</div>
                    {h.label !== h.handle && (
                      <div className="text-xs text-gray-400">{h.label}</div>
                    )}
                  </div>
                  <button
                    onClick={async () => { await api.twitterToggleHandle(h.handle); await loadAll(); }}
                    className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                      h.enabled
                        ? "border-green-200 bg-green-50 text-green-600"
                        : "border-gray-200 bg-gray-50 text-gray-400"
                    }`}
                  >
                    {h.enabled ? "Enabled" : "Disabled"}
                  </button>
                  <button
                    onClick={async () => { await api.twitterRemoveHandle(h.handle); await loadAll(); }}
                    className="text-xs text-red-400 hover:text-red-600"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
