import http.server, socketserver, functools

DIRECTORY = "/Users/pablo/Desktop/Personal/Hyper Island/Module - Intelligent Machine/team-playground/public"
PORT = 8778

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIRECTORY)

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

with Server(("127.0.0.1", PORT), Handler) as httpd:
    httpd.serve_forever()
