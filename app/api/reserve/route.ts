import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { videoId, title, thumbnail, singerName } =
    await req.json();

  const existing = await prisma.queue.findFirst({
    where: {
      videoId,
      status: "waiting",
    },
  });

  if (existing) {
    return NextResponse.json(
      { error: "Song already reserved" },
      { status: 400 }
    );
  }

  const song = await prisma.queue.create({
    data: {
      videoId,
      title,
      thumbnail,
      singerName,
    },
  });

  return NextResponse.json(song);
}
