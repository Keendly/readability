jsdom = require('jsdom').jsdom;

r = require('readability-node');
var bunyan = require('bunyan');
var AWS = require('aws-sdk');

const uuidV4 = require('uuid/v4');

var LOG = bunyan.createLogger({name: 'readability'});

var S3 = new AWS.S3();

var TIMEOUT = 1000 * 60 * 2 // 1 minutes

var USER_AGENTS = [
        "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/54.0.2840.71 Safari/537.36",
        "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/54.0.2840.71 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/54.0.2840.99 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/54.0.2840.71 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; WOW64; rv:49.0) Gecko/20100101 Firefox/49.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/54.0.2840.71 Safari/537.36",
        "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:50.0) Gecko/20100101 Firefox/50.0",
        "Mozilla/5.0 (Windows NT 6.1; WOW64; Trident/7.0; rv:11.0) like Gecko",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_6) AppleWebKit/602.2.14 (KHTML, like Gecko) Version/10.0.1 Safari/602.2.14",
        "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:50.0) Gecko/20100101 Firefox/50.0"
]

function uploadToS3(content, callback) {
    key = 'messages/' + uuidV4()
    S3.putObject({
        Bucket: 'keendly',
        Key: key,
        Body: JSON.stringify(content)
    }, function (err, data) {
        if (err) {
            throw err;
        } else {
            console.log(key)
            callback(null, key)
        }
     });
}

exports.myHandler = function(event, context, callback) {
    // do not wait for all requests to finish, exit after timeout
    context.callbackWaitsForEmptyEventLoop = false

    var waitForMe = []
    LOG.info(event)
    p = new Promise(function(resolve) {
            S3.getObject({
                'Bucket': 'keendly',
                'Key': event['articlesContent']
            }, function(err, data) {
                if (err){
                    LOG.info('No need to download items')
                } else {
                    LOG.info('Downloaded items from s3')
                    event['items'] = JSON.parse(data.Body.toString('utf-8'))
                }
                resolve()
            });
    })

    var ret = []
    p.then(function() {
        for (var url in event['items']) {
            LOG.info('Processing ' + url)
            try {
                var doc = jsdom(event['items'][url], {features: {
                                    FetchExternalResources: false,
                                    ProcessExternalResources: false
                                }});
                var article = new r.Readability(url, doc).parse();
                if (article && article.content){
                    LOG.info({event: 'extracted', url: url});
                    ret.push({
                        'url': url,
                        'text': article.content
                    })
                } else {
                    LOG.warn({event: 'empty', url: url});
                    // TODO remove it
                    ret.push({
                        'url': url,
                        'text': "Couldnt extract from: " + body
                    })
                }
            } catch (error) {
                LOG.error({event: 'extract_error', url: url, error: error});
                // TODO remove it
                ret.push({
                    'url': url,
                    'text': "Error extracting " + error
                })
            }
        }
        LOG.info({event: 'finished'})
        uploadToS3(ret, callback)
    })
}
