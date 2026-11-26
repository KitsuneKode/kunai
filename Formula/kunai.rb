# typed: false
# frozen_string_literal: true

# Homebrew formula for Kunai — rendered by scripts/packaging/render-channels.ts
# from the published SHA256SUMS.archives. Do not edit by hand; the packaging
# workflow regenerates this file on every release.
class Kunai < Formula
  desc "Terminal-first streaming CLI for anime, series, and movies, played in mpv"
  homepage "https://kunai.kitsunekode.in"
  version "0.3.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/KitsuneKode/kunai/releases/download/v0.3.0/kunai-darwin-arm64.tar.gz"
      sha256 "6b6078de767dd209d284edf765ddb1d15099973a7994727f92d50c09a459a5a1"
    end
    on_intel do
      url "https://github.com/KitsuneKode/kunai/releases/download/v0.3.0/kunai-darwin-x64.tar.gz"
      sha256 "3fe148035741bf772a411ef729c64bcb29af241950f6c898c3cec3277b97c42d"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/KitsuneKode/kunai/releases/download/v0.3.0/kunai-linux-arm64.tar.gz"
      sha256 "2151ede4b3c8f9a14249bd5182d852bf0d1ddb0f5205e48d4b3c0ad511c9cf31"
    end
    on_intel do
      url "https://github.com/KitsuneKode/kunai/releases/download/v0.3.0/kunai-linux-x64.tar.gz"
      sha256 "b1bc0eb2c8e04138c5713031986b79dcc28f9680e4dc025b59fecc748adc13bf"
    end
  end

  # Every archive ships exactly one platform-named binary (e.g. kunai-darwin-arm64).
  def install
    bin.install Dir["kunai-*"].first => "kunai"
    system "/usr/bin/codesign", "--force", "--sign", "-", bin/"kunai" if OS.mac? && Hardware::CPU.arm?
  end

  def caveats
    <<~EOS
      Kunai plays media through mpv — install it if you do not already have it:
        brew install mpv
      Optional extras enable more sources and downloads:
        brew install yt-dlp ffmpeg
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/kunai --version")
  end
end
