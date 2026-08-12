// 本地端到端测试用的 Redis 兼容服务（miniredis）。
// 仅用于开发/测试环境，生产部署使用真实 Redis。
package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/alicebob/miniredis/v2"
)

func main() {
	addr := "127.0.0.1:6379"
	if len(os.Args) > 1 {
		addr = os.Args[1]
	}
	server := miniredis.NewMiniRedis()
	if err := server.StartAddr(addr); err != nil {
		fmt.Fprintf(os.Stderr, "miniredis start failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("miniredis listening on %s\n", addr)
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	server.Close()
}
