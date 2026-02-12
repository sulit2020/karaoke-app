import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST() {
  const current = await prisma.queue.findFirst({
    where: { status: "playing" },
  });

  if (current) {
    await prisma.queue.update({
      where: { id: current.id },
      data: { status: "done" },
    });
  }

  const next = await prisma.queue.findFirst({
    where: { status: "waiting" },
    orderBy: { createdAt: "asc" },
  });

  if (next) {
    await prisma.queue.update({
      where: { id: next.id },
      data: { status: "playing" },
    });
  }

  return NextResponse.json({ success: true });
}
