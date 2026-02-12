import { NextResponse } from "next/server";
import axios from "axios";

export async function POST(req: Request) {
  const { query } = await req.json();

  const response = await axios.get(
    "https://www.googleapis.com/youtube/v3/search",
    {
      params: {
        part: "snippet",
        q: `${query} karaoke`,
        type: "video",
        videoEmbeddable: "true",
        maxResults: 10,
        key: process.env.YOUTUBE_API_KEY,
      },
    }
  );

  const videos = response.data.items.map((item: any) => ({
    videoId: item.id.videoId,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails.medium.url,
  }));

  return NextResponse.json(videos);
}
