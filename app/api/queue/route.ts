import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  const queue = await prisma.queue.findMany({
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(queue);
}

export async function DELETE(req: Request) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

    await prisma.queue.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 });
  }
}
