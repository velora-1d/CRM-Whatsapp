"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MessageSquare, ArrowLeft, ShieldAlert } from "lucide-react";

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <Card className="w-full max-w-md border-slate-800 bg-slate-900">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10">
            <ShieldAlert className="h-6 w-6 text-amber-500" />
          </div>
          <CardTitle className="text-xl text-white">Reset Password</CardTitle>
          <CardDescription className="text-slate-400">
            Fitur reset password dinonaktifkan untuk instalasi mandiri (self-hosted).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-center text-sm text-slate-400">
            Silakan hubungi administrator sistem atau database administrator Anda untuk melakukan reset password akun Anda secara manual.
          </p>

          <Link href="/login" className="w-full">
            <Button
              variant="outline"
              className="w-full border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              Kembali ke Login
            </Button>
          </Link>

          <Link
            href="/login"
            className="mt-2 flex items-center justify-center gap-2 text-sm text-slate-400 hover:text-slate-300"
          >
            <ArrowLeft className="h-4 w-4" />
            Kembali ke Halaman Masuk
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

